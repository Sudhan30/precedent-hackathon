import {findTable,queryWarehouse,type WarehouseRows} from '../warehouse/index.js';
import {recordUsage} from '../incidents/index.js';
import {asRuntime,type DomainRuntime} from '../../apps/server/runtime.js';
import {fixtureResult} from '../demo-tools/fixtures.js';
import {randomUUID} from 'node:crypto';
import type {Precedent} from '../../apps/server/service.js';
import {evaluate} from '../policy-engine/index.js';
import {registry,type Action,type Grant} from '../contracts/index.js';
export interface Downstream{execute(action:Action,id:string,baseline:boolean):Promise<Record<string,any>>;receipts():Promise<any[]>;}
export class ExecutionGateway{
 private runtime:DomainRuntime;private tail:Promise<unknown>=Promise.resolve();
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const job=this.tail.then(fn);this.tail=job.catch(()=>undefined);return job;}
 exclusive<T>(fn:()=>Promise<T>){return this.serial(fn);}
 control<T>(fn:(service:Precedent)=>T|Promise<T>){return this.serial(()=>this.runtime.run(fn));}
 // warehouseRows, when supplied, reads warehouse.query rows from the database (MongoDB Atlas).
 constructor(service:Precedent|DomainRuntime,private downstream:Downstream,private warehouseRows?:WarehouseRows){this.runtime=asRuntime(service);}
 async recover(){await this.runtime.run(service=>{for(const session of service.store.all('session'))if(session.workerLastSeen!=null){service.record('session',{...session,workerLastSeen:null});service.emit('worker.disconnected',{sessionId:session.id,reason:'Backend restart; waiting for a fresh heartbeat'});}for(const e of service.store.all('execution'))if(e.status==='DISPATCHING'){const unknown={...e,status:'UNKNOWN'};service.record('execution',unknown);recordUsage(service,unknown);service.emit('execution.unknown',{executionId:e.id,reason:'Recovered unfinished dispatch; retry prohibited'});}
  // Accepted comparisons survive in audit storage, but their in-process job
  // does not survive a backend restart. Report interruption, never replay it.
  for(const run of service.store.all('run'))if(['PREPARING','RETRIEVING','PLANNING','EXECUTING'].includes(run.status)){
   service.store.put('run',{...run,status:'FAILED',failedPhase:'backend restart'});
   service.emit('run.failed',{runId:run.id,sessionId:run.sessionId,phase:'backend restart',reasonCode:'BACKEND_RESTART'});
  }
 });}
 async execute(action:Action,id:string,baseline=false){return this.serial(()=>this.executeInside(action,id,baseline));}
 private async executeInside(action:Action,id:string,baseline=false){
  const intent=await this.runtime.run(service=>service.store.atomic(()=>{
   const old=service.store.get('execution',id);if(old){if(JSON.stringify(old.action)!==JSON.stringify(action)||old.baseline!==baseline)throw new Error('Idempotency key reused for another action');return {record:old,dispatch:false};}
   service.emit('action.proposed',{executionId:id,sessionId:action.sessionId,action});service.workerHeartbeat(action.sessionId);const session=service.store.get('session',action.sessionId);const currentPolicy=service.policy();
   const policy=currentPolicy,grants=service.store.all<Grant>('grant'),at=service.clock();
   const evaluationStarted=performance.now();const decision=baseline?{verdict:'ALLOW',policyVersion:policy.version,ruleId:'BASELINE',reason:'Controlled synthetic comparison bypass'}:evaluate(action,policy,grants,at);
   const evaluationDurationMs=performance.now()-evaluationStarted;
   const record={id,runId:session?.runId??null,demoRunId:service.demo().demoRunId,action,toolVersion:registry[action.toolId].version,principalId:session?.principalId??null,baseline,decision,grants,at,status:decision.verdict==='ALLOW'?'DISPATCHING':decision.verdict==='BLOCK'?'BLOCKED':'PENDING',receiptId:null as string|null};
   service.record('execution',record);recordUsage(service,record);service.emit('decision.recorded',{executionId:id,sessionId:action.sessionId,decision,evaluationDurationMs,evaluationSource:baseline?'controlled-bypass':'deterministic-policy'});
   if(decision.verdict==='REQUIRE_APPROVAL'){service.record('approval',{id,action,policyVersion:policy.version,status:'PENDING',at});service.emit('approval.requested',{executionId:id,sessionId:action.sessionId});}
   if('grantId' in decision&&decision.grantId){const g=service.store.get('grant',decision.grantId as string)!;service.record('grant',{...g,consumed:true});}
   // Intent and "started" commit together; dispatch follows immediately after this commit.
   if(decision.verdict==='ALLOW'){service.emit('execution.intent',{executionId:id,sessionId:action.sessionId});service.emit('execution.started',{executionId:id,sessionId:action.sessionId});}else this.episode(service,record);
   return {record,dispatch:decision.verdict==='ALLOW'};
  }));
  if(!intent.dispatch)return intent.record;
  // Intent and grant consumption have committed before this dispatch. All inputs
  // refer to controlled synthetic fixtures; agents cannot choose URLs or payloads.
  const dispatchStarted=performance.now();
  try{
   const result=registry[action.toolId].external?await this.downstream.execute(action,id,baseline):
    action.toolId==='warehouse.query'&&this.warehouseRows&&findTable(action.target)?{result:queryWarehouse(action.target,await this.warehouseRows(action.target!),'read from MongoDB Atlas').summary}:
    {result:fixtureResult(action.resourceId,action.toolId,action.target)};
   const dispatchDurationMs=performance.now()-dispatchStarted;
   return await this.runtime.run(service=>service.store.atomic(()=>{const receipt={id:randomUUID(),runId:intent.record.runId,demoRunId:intent.record.demoRunId,executionId:id,toolId:action.toolId,toolVersion:registry[action.toolId].version,sessionId:action.sessionId,baseline,at:service.clock(),result:result.result,downstreamReceiptId:result.receiptId??null};service.record('receipt',receipt);const completed={...intent.record,status:'SUCCEEDED',receiptId:receipt.id};service.record('execution',completed);recordUsage(service,completed);service.emit('execution.completed',{executionId:id,sessionId:action.sessionId,receiptId:receipt.id,dispatchDurationMs});this.episode(service,completed);return completed;}));
  }catch{
   const unknown={...intent.record,status:'UNKNOWN'};await this.runtime.run(service=>service.store.atomic(()=>{service.record('execution',unknown);recordUsage(service,unknown);service.emit('execution.unknown',{executionId:id,sessionId:action.sessionId,reason:'Dispatch result could not be confirmed; no automatic retry',dispatchDurationMs:performance.now()-dispatchStarted});}));return unknown;
  }
 }
 private episode(service:Precedent,execution:any){if(execution.baseline)return;service.record('episode',{id:randomUUID(),...service.episodeScope(execution.action.sessionId),sessionId:execution.action.sessionId,toolId:execution.action.toolId,resourceId:execution.action.resourceId,policyVersion:execution.decision.policyVersion,at:service.clock(),decision:execution.decision.verdict,summary:`${execution.decision.reason}. ${execution.status}${execution.receiptId?': '+service.store.get('receipt',execution.receiptId)?.result:''}`,alternative:execution.decision.alternative??null,evidenceId:execution.id});service.emit('episode.saved',{executionId:execution.id});}
 async receipts(){return this.downstream.receipts();}
}

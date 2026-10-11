import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {OTLPHttpJsonTraceExporter} from '@vercel/otel';
import {SimpleSpanProcessor,type SpanExporter} from '@opentelemetry/sdk-trace-base';
import {BackendTelemetry,TelemetryRuntime} from '../packages/observability/index.js';
import {verifyRaindropEvent,verifyRaindropGovernance,type ExpectedGovernanceDecision} from '../packages/observability/raindrop-query.js';
import {LocalRuntime} from '../apps/server/runtime.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {ExecutionGateway} from '../packages/execution/index.js';
import {connectConnector} from '../packages/demo-tools/client.js';

if(!process.env.RAINDROP_WRITE_KEY||!process.env.RAINDROP_QUERY_API_KEY)throw new Error('Configure Raindrop write and query keys in ignored .env.local.');
const transport=new OTLPHttpJsonTraceExporter({url:'https://api.raindrop.ai/v1/traces',headers:{Authorization:'Bearer '+process.env.RAINDROP_WRITE_KEY}});
let exported=0,rejected=false;
const exporter:SpanExporter={export(spans,callback){transport.export(spans,result=>{exported+=spans.filter(span=>span.attributes['ai.telemetry.metadata.raindrop.eventId']===runId).length;rejected ||= result.code!==0;callback(result);});},shutdown:()=>transport.shutdown()};
const telemetry=new BackendTelemetry(exporter,new SimpleSpanProcessor(exporter));
let clockOffset=0;
const service=new Precedent(openStore(':memory:'),()=>Date.now()+clockOffset);
const runtime=new TelemetryRuntime(new LocalRuntime(service),telemetry),connector=await connectConnector(':memory:');
const gateway=new ExecutionGateway(runtime,connector),runId='raindrop-governance-'+randomUUID();
const expected:ExpectedGovernanceDecision[]=[],cases:{label:string;status:string;verdict:string;policyVersion:number;receiptMatched:boolean}[]=[];
try{
 const session=await runtime.run(s=>s.session(undefined,undefined,runId));
 await telemetry.run({runId,mode:'governed',demoRunId:service.demo().demoRunId},async()=>{
  const execute=async(label:string,tool:'example_connector.analyze'|'internal_logs.search'|'staging_db.read',resource:'customer-logs'|'sandbox-logs'|'staging-records',environment:'production'|'sandbox',status:string)=>{
   const result=await gateway.execute(service.action(session.id,tool,resource,environment),randomUUID());assert.equal(result.status,status);
   const receipt=await runtime.run(s=>result.receiptId?s.store.get('receipt',result.receiptId):null);
   assert.equal(Boolean(receipt),status==='SUCCEEDED');if(receipt)assert.equal(receipt.executionId,result.id);
   const downstream=await connector.receipts();
   assert.equal(downstream.filter(r=>r.executionId===result.id).length,status==='SUCCEEDED'&&tool==='example_connector.analyze'?1:0);
   expected.push({executionId:result.id,verdict:result.decision.verdict,policyVersion:result.decision.policyVersion,receiptId:result.receiptId});
   cases.push({label,status:result.status,verdict:result.decision.verdict,policyVersion:result.decision.policyVersion,receiptMatched:Boolean(receipt)});return result;
  };
  await execute('restricted call blocked','example_connector.analyze','customer-logs','production','BLOCKED');
  await execute('repeated restricted call blocked','example_connector.analyze','customer-logs','production','BLOCKED');
  await execute('permitted internal alternative','internal_logs.search','customer-logs','production','SUCCEEDED');
  await execute('sandbox permitted before update','example_connector.analyze','sandbox-logs','sandbox','SUCCEEDED');
  await gateway.control(s=>s.publish({...s.policy(),sandboxAllowed:false},false,'Isolated telemetry verification policy update'));
  await execute('same sandbox action blocked after update','example_connector.analyze','sandbox-logs','sandbox','BLOCKED');
  const pending=await execute('staging requires approval','staging_db.read','staging-records','production','PENDING');
  const grant=await gateway.control(s=>s.approve(pending.id,1));assert.ok('expiresAt' in grant);
  clockOffset=1000; // Explicit controlled clock advance; no wall-clock expiry shortcut in the app.
  assert.ok(service.clock()>=grant.expiresAt);
  await execute('expired retained exception cannot authorize','staging_db.read','staging-records','production','PENDING');
  assert.ok(service.store.get('grant',grant.id));assert.equal(service.store.get('grant',grant.id)?.consumed,false);
 });
 await telemetry.flush();assert.ok(exported>0);assert.equal(rejected,false);
 console.log(JSON.stringify({runId,casesExecuted:cases.length,expectedEventSpans:exported,phase:'waiting for Raindrop indexing'}));
 const deadline=Date.now()+120000;let visibility;
 for(;;){try{visibility=await verifyRaindropEvent(runId,process.env.RAINDROP_QUERY_API_KEY);if(visibility.spanCount>=exported)break;}catch(error){if(!(error instanceof Error)||error.message!=='Raindrop has no visible spans for this event yet.')throw error;}if(Date.now()>=deadline)throw new Error('Raindrop governance spans did not finish indexing.');await new Promise(resolve=>setTimeout(resolve,2000));}
 const readback=await verifyRaindropGovernance(runId,process.env.RAINDROP_QUERY_API_KEY,expected);
 const proof={checkedAt:new Date().toISOString(),source:'Isolated real policy/MCP execution and Raindrop read-back; controlled clock and tool data; no model-quality grading',cases,total:cases.length,passed:cases.length,visibility,readback};
 mkdirSync('.data',{recursive:true});writeFileSync('.data/raindrop-governance-verification.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{await connector.close();await runtime.close();await telemetry.close();}

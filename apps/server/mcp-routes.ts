import {randomUUID} from 'node:crypto';
import type express from 'express';
import {z} from 'zod';
import type {Precedent} from './service.js';
import {policySchema} from '../../packages/contracts/index.js';
import {discoverReviewedMcp,type McpDiscovery} from '../../packages/mcp/index.js';
import {mcpConnectionDecision} from '../../packages/mcp/decision.js';
import {claudeClassifier,type McpClassification,type McpClassifier} from '../../packages/mcp/classify.js';
import {analyzeMcpProposals} from '../../packages/proposals/index.js';
import {currentRequest,draftRequest,reviewRequest,submitRequest,updateRequest} from '../../packages/mcp/requests.js';
import {endpointSchema,mcpKey,mcpNameSchema,nameFromPrompt} from '../../packages/mcp/contracts.js';

type Run=<T>(fn:(service:Precedent)=>T|Promise<T>)=>Promise<T>;
interface Dependencies{run:Run;controlAs:<T>(res:express.Response,fn:(service:Precedent)=>T|Promise<T>)=>Promise<T>;exclusive:<T>(fn:()=>Promise<T>)=>Promise<T>;admin:(res:express.Response)=>void;owned:(res:express.Response,id:string)=>void;discover?:(endpoint:string)=>Promise<McpDiscovery>;classify?:McpClassifier;}
const conflict=(message:string)=>Object.assign(new Error(message),{status:409});
export function registerMcpRequests(app:express.Express,{run,controlAs,exclusive,admin,owned,discover=discoverReviewedMcp,classify=claudeClassifier()}:Dependencies){
 // Policy check (MCP-03): the judge labels the request outside any transaction; the policy decides.
 const policyCheck=async(input:Parameters<McpClassifier>[0])=>{try{return await classify(input);}catch{return null;}};
 const dispatch=async(id:string,endpoint:string)=>{
  let outcome:McpDiscovery;try{outcome=await discover(endpoint);}catch{outcome={status:'CONNECTION_FAILED',tools:[],message:'MCP connection failed. Verify endpoint availability and network access.'};}
  return run(service=>{
   const intent=service.store.get('run',id)!;const session=service.store.get('session',intent.sessionId)!;
   const policy=policySchema.safeParse(service.policy());const access=policy.success?policy.data.mcpConnections?.find(item=>item.key===mcpKey(intent.mcpResult.name)&&item.endpoint===endpoint):undefined;
   const stale=!service.sessionIsCurrent(session)||!policy.success||intent.mode==='governed'&&(service.policy().version!==intent.mcpResult.decision.policyVersion||access?.allowed===false);
   const result={...intent,status:'FINISHED',mcpResult:{...intent.mcpResult,...outcome,...(stale?{status:'POLICY_CHANGED',tools:[],message:'Policy or demo changed during discovery. Discovered tools were not enabled.'}:{})}};
   service.record('run',result);service.emit('mcp.connection.recorded',{runId:id,sessionId:intent.sessionId,status:result.mcpResult.status,decision:result.mcpResult.decision,toolCount:result.mcpResult.tools.length});return result;
  }).then(async result=>{
   // Self-writing guardrails: repeated approved connections may now support a draft rule.
   if(result.mode==='governed'&&result.mcpResult.status==='CONNECTED')await run(service=>service.store.atomic(()=>analyzeMcpProposals(service))).catch(()=>undefined);
   return result;
  });
 };
 const startIntent=(service:Precedent,record:Record<string,any>,endpoint:string,reason:string)=>{
  const result={...record,id:record.id,sessionId:record.sessionId,status:'EXECUTING',mcpResult:{...record.mcpResult,endpoint,status:'CONNECTING',tools:[],decision:{verdict:'ALLOW',policyVersion:service.policy().version,ruleId:record.mode==='baseline'?'BASELINE':'MCP-01',reason},message:'Connection intent recorded before contacting the MCP server. Discovered tools will not be executed.'}};
  service.record('run',result);service.emit('mcp.decision.recorded',{runId:result.id,sessionId:result.sessionId,decision:result.mcpResult.decision});return result;
 };
 app.post('/api/mcp/requests/:id/submit',async(req,res)=>{
  const input=z.object({name:mcpNameSchema,endpoint:endpointSchema,purpose:z.string().trim().min(1).max(2000)}).strict().parse(req.body);
  const governedRequest=await run(service=>{const request=currentRequest(service,String(req.params.id));owned(res,request.sessionId);return service.store.get('run',request.runId)?.mode==='governed';});
  const classification=governedRequest?await policyCheck({name:input.name,endpoint:input.endpoint,purpose:input.purpose}):null;
  const result=await exclusive(async()=>{
   const intent=await run(service=>{
    const request=currentRequest(service,String(req.params.id));owned(res,request.sessionId);
    const record=service.store.get('run',request.runId)!;
    if(record.mode==='baseline'){
     if(request.status!=='DRAFT')throw conflict('Connection already submitted or closed');
     updateRequest(service,request,{...input,status:'CONSUMED'},'CONNECTING','Comparison connection attempt; company review is bypassed.');
     return startIntent(service,service.store.get('run',record.id)!,input.endpoint,'Comparison: company MCP permission is not enforced.');
    }
    if(classification){service.emit('mcp.policy.checked',{runId:record.id,sessionId:record.sessionId,searchRelated:classification.searchRelated,judge:classification.judge,requestId:request.id});
     const decision=mcpConnectionDecision(policySchema.parse(service.policy()),input.name,input.endpoint,classification);
     if(decision.ruleId==='MCP-03'){
      if(request.status!=='DRAFT')throw conflict('This request has already been submitted or closed');
      updateRequest(service,request,{...input,status:'DENIED',reason:decision.reason},'BLOCKED','Blocked by company policy. No connection attempted, and no approval is possible.');
      const closed=service.store.get('run',request.runId)!;service.record('run',{...closed,mcpResult:{...closed.mcpResult,decision,classification}});return service.store.get('run',request.runId)!;
     }
     const pending=submitRequest(service,request.id,input);const updated=service.store.get('run',request.runId)!;service.record('run',{...updated,mcpResult:{...updated.mcpResult,classification}});void pending;return service.store.get('run',request.runId)!;
    }
    submitRequest(service,request.id,input);return service.store.get('run',request.runId)!;
   });
   return intent.status==='EXECUTING'?dispatch(intent.id,input.endpoint):intent;
  });res.json(result);
 });
 app.post('/api/mcp/requests/:id/cancel',async(req,res)=>{
  z.object({}).strict().parse(req.body);
  res.json(await exclusive(()=>run(service=>{
   const request=currentRequest(service,String(req.params.id));owned(res,request.sessionId);
   if(!['DRAFT','PENDING','APPROVED'].includes(request.status))throw conflict('This MCP request is already closed');
   updateRequest(service,request,{status:'CANCELLED'},'CANCELLED','Request cancelled. No connection was attempted.');return service.store.get('run',request.runId)!;
  })));
 });
 app.post('/api/mcp/requests/:id/review',async(req,res)=>{
  admin(res);const input=z.object({allow:z.boolean(),scope:z.enum(['once','company']),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(1000),ttlSeconds:z.number().finite().int().min(1).max(300).default(30)}).strict().parse(req.body);
  res.json(await controlAs(res,service=>{const request=currentRequest(service,String(req.params.id));if(request.tenantId!==res.locals.principal.tenantId)throw Object.assign(new Error('Request access denied'),{status:403});if(input.allow&&service.store.get('run',request.runId)?.mcpResult?.classification?.searchRelated)throw conflict('Web search and browsing MCPs are blocked by policy MCP-03 and cannot be approved');return reviewRequest(service,request.id,input);}));
 });
 app.post('/api/mcp/requests/:id/resume',async(req,res)=>{
  z.object({}).strict().parse(req.body);
  const result=await exclusive(async()=>{
   const intent=await run(service=>{
    const request=currentRequest(service,String(req.params.id));owned(res,request.sessionId);
    if(request.status!=='APPROVED'||!request.endpoint)throw conflict('A current, unused MCP approval is required');
    if(request.scope==='once'&&(!request.expiresAt||request.expiresAt<=service.clock())){updateRequest(service,request,{status:'EXPIRED'},'EXPIRED','Approval expired. No connection was attempted. Send a fresh request.');return service.store.get('run',request.runId)!;}
    if(request.policyVersion!==service.policy().version)throw conflict('Policy changed. Cancel this request and submit a fresh one.');
    const policy=policySchema.parse(service.policy());
    if(mcpConnectionDecision(policy,request.name,request.endpoint,service.store.get('run',request.runId)?.mcpResult?.classification).verdict==='BLOCK')throw conflict('Current MCP policy no longer permits this endpoint');
    updateRequest(service,request,{status:'CONSUMED'},'CONNECTING','Approved connection attempt recorded.');
    return startIntent(service,service.store.get('run',request.runId)!,request.endpoint,request.scope==='company'?'Reviewed company MCP policy permits this endpoint.':'Current scoped one-use MCP approval permits this connection attempt.');
   });return intent.status==='EXECUTING'?dispatch(intent.id,intent.mcpResult.endpoint):intent;
  });res.json(result);
 });
 app.post('/api/mcp/connections/:key',async(req,res)=>{
  admin(res);const input=z.object({allowed:z.boolean(),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(1).max(1000)}).strict().parse(req.body);
  res.json(await controlAs(res,service=>{
   if(service.policy().version!==input.expectedVersion)throw conflict('Policy changed; refresh before publishing');
   const connections=service.policy().mcpConnections??[];if(!connections.some(item=>item.key===req.params.key))throw new Error('Unknown reviewed MCP');
   return service.publish({...service.policy(),mcpConnections:connections.map(item=>item.key===req.params.key?{...item,allowed:input.allowed}:item)},false,input.reason);
  }));
 });
 return async(res:express.Response,task:string,target:'both'|'baseline'|'governed')=>{
  const comparisonId=randomUUID(),runs=[];const name=nameFromPrompt(task);
  const alreadyBlocked=await run(service=>mcpConnectionDecision(policySchema.parse(service.policy()),name).verdict==='BLOCK');
  const classification:McpClassification|null=target!=='baseline'&&!alreadyBlocked?await policyCheck({prompt:task,name}):null;
  for(const mode of (target==='both'?['baseline','governed']:[target]) as ('baseline'|'governed')[]){
   runs.push(await exclusive(async()=>{
    const record=await run(service=>{
     const policy=policySchema.parse(service.policy());const checked=mode==='governed'?classification:null;const governed=mcpConnectionDecision(policy,name,undefined,checked);const configured=governed.endpoint?{endpoint:governed.endpoint}:undefined;
     const id=randomUUID(),session=service.session({tenantId:res.locals.principal.tenantId,role:res.locals.principal.role},res.locals.principal.userId,id);res.locals.principal.sessions.add(session.id);
     const blocked=mode==='governed'&&governed.verdict==='BLOCK';
     const record={id,comparisonId,demoRunId:service.demo().demoRunId,sessionId:session.id,task,mode,scenario:'mcp',planner:'Explicit MCP connection request; no model-generated plan',plan:[],createdAt:service.clock(),status:blocked?'FINISHED':'WAITING',executionIds:[],mcpResult:{name,endpoint:configured?.endpoint??'',status:blocked?'BLOCKED':'CONFIGURATION_REQUIRED',tools:[],decision:{verdict:blocked?'BLOCK':'REQUIRE_APPROVAL',policyVersion:policy.version,ruleId:blocked?governed.ruleId:'MCP-01',reason:blocked?governed.reason:'This MCP is not configured in company policy.'},message:blocked?'No connection attempted.':'Supply the public HTTPS endpoint, then request approval or cancel. No connection has been attempted.',...(checked?{classification:checked}:{})}};
     service.record('run',record);if(checked)service.emit('mcp.policy.checked',{runId:id,sessionId:session.id,searchRelated:checked.searchRelated,judge:checked.judge,ruleId:governed.ruleId});
     if(configured&&!blocked)return startIntent(service,record,configured.endpoint,mode==='baseline'?'Comparison: company MCP permission is not enforced.':'Reviewed company MCP policy permits this endpoint.');
     if(!blocked){const request=draftRequest(service,id,session.id,name,task);service.emit('mcp.decision.recorded',{runId:id,sessionId:session.id,decision:record.mcpResult.decision,requestId:request.id});const updated={...record,mcpResult:{...record.mcpResult,requestId:request.id}};service.record('run',updated);return updated;}
     service.emit('mcp.decision.recorded',{runId:id,sessionId:session.id,decision:record.mcpResult.decision});return record;
    });return record.status==='EXECUTING'?dispatch(record.id,record.mcpResult.endpoint):record;
   }));
  }return {comparisonId,runs};
 };
}

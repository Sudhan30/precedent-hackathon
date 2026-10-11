import {randomUUID} from 'node:crypto';
import type {Precedent} from '../../apps/server/service.js';
import {mcpRequestSchema,mcpKey,type McpRequest} from './contracts.js';
import {recordDemand} from './demand.js';

const conflict=(message:string)=>Object.assign(new Error(message),{status:409});
export function currentRequest(service:Precedent,id:string){const request=service.store.get('mcp_request',id);if(!request)throw new Error('Unknown MCP request');service.requireCurrentSession(request.sessionId);return mcpRequestSchema.parse(request);}
export function updateRequest(service:Precedent,request:McpRequest,fields:Partial<McpRequest>,status:string,message:string){
 const updated=mcpRequestSchema.parse({...request,...fields});service.record('mcp_request',updated);
 const run=service.store.get('run',request.runId)!;service.record('run',{...run,status:['DRAFT','PENDING','APPROVED'].includes(updated.status)?'WAITING':'FINISHED',mcpResult:{...run.mcpResult,name:updated.name,endpoint:updated.endpoint??'',status,message,requestId:updated.id}});
 service.emit('mcp.request.'+updated.status.toLowerCase(),{runId:request.runId,sessionId:request.sessionId,requestId:request.id});return updated;
}
export function draftRequest(service:Precedent,runId:string,sessionId:string,name:string,purpose:string,endpoint:string|null=null){
 const session=service.requireCurrentSession(sessionId);const request=mcpRequestSchema.parse({id:randomUUID(),runId,sessionId,demoRunId:service.demo().demoRunId,tenantId:session.tenantId,requesterId:session.principalId??session.actorId??'engineer-1',name,endpoint,purpose,policyVersion:service.policy().version,status:'DRAFT',createdAt:service.clock()});service.record('mcp_request',request);return request;
}
export function submitRequest(service:Precedent,id:string,input:{name:string;endpoint:string;purpose:string}){
 const request=currentRequest(service,id);if(request.status!=='DRAFT')throw conflict('This request has already been submitted or closed');
 if(mcpKey(input.name)==='tenable')throw new Error('Use the existing Tenable MCP access settings');
 const configured=service.policy().mcpConnections?.find(item=>item.key===mcpKey(input.name));if(configured)throw conflict('This MCP is now configured. Send a fresh connection prompt.');
 const next=updateRequest(service,request,{...input,status:'PENDING',policyVersion:service.policy().version},'PENDING_APPROVAL','Request submitted. An administrator must review this endpoint before any connection.');
 const record=service.store.get('run',request.runId)!;service.record('run',{...record,mcpResult:{...record.mcpResult,decision:{verdict:'REQUIRE_APPROVAL',policyVersion:next.policyVersion,ruleId:'MCP-01',reason:'Unknown MCP requires administrator review.'}}});recordDemand(service,next);return next;
}
export function reviewRequest(service:Precedent,id:string,input:{allow:boolean;scope:'once'|'company';expectedVersion:number;reason:string;ttlSeconds:number}){
 const request=currentRequest(service,id);if(request.status!=='PENDING')throw conflict('MCP request is not pending');
 if(input.expectedVersion!==service.policy().version||request.policyVersion!==service.policy().version)throw conflict('Policy changed. Cancel this request and submit a fresh one.');
 if(!request.endpoint)throw new Error('An MCP endpoint is required');
 let policyVersion=request.policyVersion;
 if(input.scope==='company'){
  const connections=service.policy().mcpConnections??[];if(connections.some(item=>item.key===mcpKey(request.name)))throw conflict('MCP configuration changed');
  const policy=service.publish({...service.policy(),mcpConnections:[...connections,{key:mcpKey(request.name),name:request.name,endpoint:request.endpoint,allowed:input.allow}]},false,input.reason);policyVersion=policy.version;
 }
 const next=updateRequest(service,request,{status:input.allow?'APPROVED':'DENIED',scope:input.scope,policyVersion,expiresAt:input.allow&&input.scope==='once'?service.clock()+input.ttlSeconds*1000:null,reviewedBy:service.reviewerId,reviewedAt:service.clock(),reason:input.reason},input.allow?'APPROVED':'DENIED',input.allow?'Administrator approved the connection. Resume to attempt discovery; tools are not authorized.':'Administrator denied this connection. No connection was attempted.');
 const run=service.store.get('run',request.runId)!;service.record('run',{...run,mcpResult:{...run.mcpResult,decision:{verdict:input.allow?'ALLOW':'BLOCK',policyVersion,ruleId:'MCP-01',reason:input.reason}}});
 // A company-wide decision answers everyone waiting on the same MCP: same endpoint is approved
 // (each person still resumes their own connection); a different endpoint, or a denial, is closed.
 if(input.scope==='company')for(const other of service.store.all<McpRequest>('mcp_request')){
  if(other.id===request.id||other.status!=='PENDING'||other.demoRunId!==request.demoRunId||other.tenantId!==request.tenantId||mcpKey(other.name)!==mcpKey(request.name))continue;
  const allowed=input.allow&&other.endpoint===request.endpoint;
  const reason=allowed?input.reason:input.allow?`Company policy now permits only ${request.endpoint}.`:input.reason;
  updateRequest(service,mcpRequestSchema.parse(other),{status:allowed?'APPROVED':'DENIED',scope:'company',policyVersion,expiresAt:null,reviewedBy:service.reviewerId,reviewedAt:service.clock(),reason},allowed?'APPROVED':'DENIED',allowed?'Approved company-wide. Resume to attempt discovery; tools are not authorized.':`Closed by a company-wide decision: ${reason}`);
  const otherRun=service.store.get('run',other.runId);if(otherRun)service.record('run',{...otherRun,mcpResult:{...otherRun.mcpResult,decision:{verdict:allowed?'ALLOW':'BLOCK',policyVersion,ruleId:'MCP-01',reason}}});
 }
 return next;
}

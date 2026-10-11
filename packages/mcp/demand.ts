import type {Precedent} from '../../apps/server/service.js';
import {mcpKey,type McpRequest} from './contracts.js';
// Demand for one MCP across the company: how many distinct people asked for it. The same person
// asking again never raises the count; each new person adds one. Reviewers see the most-wanted
// MCPs first. Requests blocked outright by policy (MCP-03) are not counted: they cannot be approved.
export interface McpDemand{id:string;demoRunId:string;tenantId:string;key:string;name:string;endpoint:string|null;count:number;requesterIds:string[];requestIds:string[];departments:string[];firstAt:number;lastAt:number}
export const demandId=(demoRunId:string,tenantId:string,key:string)=>`mcp-demand:${demoRunId}:${tenantId}:${key}`;
export function recordDemand(service:Precedent,request:McpRequest){
 const key=mcpKey(request.name),id=demandId(request.demoRunId,request.tenantId,key),now=service.clock();
 const current=service.store.get<McpDemand>('mcp_demand',id);
 const bumped=!current?.requesterIds.includes(request.requesterId);
 const department=service.store.get('session',request.sessionId)?.department as string|undefined;
 const departments=[...new Set([...(current?.departments??[]),...(department?[department]:[])])];
 const demand:McpDemand=current?{...current,name:request.name,endpoint:request.endpoint??current.endpoint,count:current.count+(bumped?1:0),requesterIds:bumped?[...current.requesterIds,request.requesterId]:current.requesterIds,requestIds:current.requestIds.includes(request.id)?current.requestIds:[...current.requestIds,request.id],departments,lastAt:now}
  :{id,demoRunId:request.demoRunId,tenantId:request.tenantId,key,name:request.name,endpoint:request.endpoint??null,count:1,requesterIds:[request.requesterId],requestIds:[request.id],departments,firstAt:now,lastAt:now};
 service.record('mcp_demand',demand);
 service.emit('mcp.demand.updated',{requestId:request.id,sessionId:request.sessionId,key,count:demand.count,bumped});
 return {demand,bumped};
}
export function demandFor(service:Precedent,request:Pick<McpRequest,'demoRunId'|'tenantId'|'name'>){return service.store.get<McpDemand>('mcp_demand',demandId(request.demoRunId,request.tenantId,mcpKey(request.name)));}

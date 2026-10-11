import {type Grant,registry} from '../contracts/index.js';
import {evaluate} from '../policy-engine/index.js';
import type {Precedent} from '../../apps/server/service.js';
export interface IncidentGraphData{
 at:number;policyVersion:number;
 tools:{id:string;toolId:string;version:string;quarantined:boolean}[];
 sessions:{id:string;agentId:string;acknowledgedVersion:number|null;workerSource:string;lastSeen:number|null;status:string;seeded:boolean}[];
 edges:{id:string;sessionId:string;toolId:string;toolVersion:string;kind:string;baseline:boolean;at:number;receiptId:string|null;resourceId?:string;environment?:string;expiresAt?:number}[];
 exposure:{governedSessions:string[];baselineSessions:string[];blockedAttempts:number;unknownOutcomes:number};
}
function usageEdge(service:Precedent,execution:Record<string,any>){
 const receipt=execution.receiptId?service.store.get('receipt',execution.receiptId):undefined;
 const confirmed=receipt&&receipt.executionId===execution.id&&receipt.sessionId===execution.action.sessionId&&receipt.toolId===execution.action.toolId&&receipt.baseline===execution.baseline&&(!execution.toolVersion||receipt.toolVersion===execution.toolVersion);
 const kind=execution.status==='SUCCEEDED'&&confirmed?'executed':execution.status==='BLOCKED'?'blocked':(execution.status==='UNKNOWN'||execution.status==='SUCCEEDED')?'unknown':execution.status==='DISPATCHING'?'inflight':execution.status==='DENIED'?'denied':'held';
 return {id:execution.id,demoRunId:execution.demoRunId??service.store.get('session',execution.action.sessionId)?.demoRunId??service.demo().legacyDemoRunId,sessionId:execution.action.sessionId,toolId:execution.action.toolId,toolVersion:execution.toolVersion??receipt?.toolVersion??'unrecorded',environment:execution.action.environment,resourceId:execution.action.resourceId,baseline:execution.baseline,kind,at:execution.at,receiptId:confirmed?receipt.id:null,policyVersion:execution.decision?.policyVersion??null};
}
export function recordUsage(service:Precedent,execution:Record<string,any>){service.store.put('usage_edge',usageEdge(service,execution));}
export function incidentGraph(service:Precedent,toolId?:string,toolVersion?:string):IncidentGraphData{
 const sessions=service.currentSessions();const sessionIds=new Set(sessions.map(s=>s.id));const at=service.clock();const policy=service.policy();
 const usage=service.store.all('execution').filter(e=>e.action?.sessionId&&e.action?.toolId).map(e=>usageEdge(service,e)).filter(e=>sessionIds.has(e.sessionId)&&(!toolId||e.toolId===toolId)&&(!toolVersion||e.toolVersion===toolVersion));
 const configured=sessions.flatMap(s=>(s.configuredTools??[]).filter((tool:Record<string,any>)=>(!toolId||tool.toolId===toolId)&&(!toolVersion||tool.toolVersion===toolVersion)).map((tool:Record<string,any>)=>({id:'configured:'+s.id+':'+tool.toolId+'@'+tool.toolVersion,sessionId:s.id,...tool,kind:'configured',baseline:false,at:s.createdAt,receiptId:null})));
 const exceptions=service.store.all<Grant>('grant').filter(g=>sessionIds.has(g.action.sessionId)&&(!toolId||g.action.toolId===toolId)&&(!toolVersion||g.toolVersion===toolVersion)&&!g.revoked&&!g.consumed&&g.expiresAt>at&&g.policyVersion===policy.version&&((decision)=>'grantId' in decision&&decision.grantId===g.id)(evaluate(g.action,policy,[g],at))).map(g=>({id:'grant:'+g.id,sessionId:g.action.sessionId,toolId:g.action.toolId,toolVersion:g.toolVersion,environment:g.action.environment,resourceId:g.action.resourceId,kind:'exception',baseline:false,at,expiresAt:g.expiresAt,receiptId:null}));
 const edges=[...configured,...usage,...exceptions];const tools=[...new Map(edges.map(e=>[e.toolId+'@'+e.toolVersion,{id:e.toolId+'@'+e.toolVersion,toolId:e.toolId,version:e.toolVersion,quarantined:policy.quarantined.includes(e.toolId+'@'+e.toolVersion)}])).values()];
 return {at,policyVersion:policy.version,tools,sessions:sessions.filter(s=>edges.some(e=>e.sessionId===s.id)).map(s=>({id:s.id,agentId:s.agentId,acknowledgedVersion:s.seeded?null:s.acknowledgedVersion??null,workerSource:s.workerSource??'unobserved',lastSeen:s.workerLastSeen??null,status:!s.seeded&&s.workerLastSeen!=null&&at-s.workerLastSeen<30000?'connected':'offline',seeded:Boolean(s.seeded)})),edges,exposure:{governedSessions:[...new Set(usage.filter(e=>e.kind==='executed'&&!e.baseline).map(e=>e.sessionId))],baselineSessions:[...new Set(usage.filter(e=>e.kind==='executed'&&e.baseline).map(e=>e.sessionId))],blockedAttempts:usage.filter(e=>e.kind==='blocked').length,unknownOutcomes:usage.filter(e=>e.kind==='unknown').length}};
}
// Read-only blast radius for a tool version, before anyone quarantines it. A blocked
// attempt never reached the tool, so it is not exposure; configured access that was
// never used is risk, not exposure. Nothing here writes a record or calls a tool.
export function blastRadius(service:Precedent,toolId:keyof typeof registry){
 const toolVersion=registry[toolId].version;const graph=incidentGraph(service,toolId,toolVersion);
 const usage=graph.edges.filter(e=>!['configured','exception'].includes(e.kind));
 const executed=usage.filter(e=>e.kind==='executed'&&!e.baseline),baseline=usage.filter(e=>e.kind==='executed'&&e.baseline),blocked=usage.filter(e=>e.kind==='blocked');
 const used=new Set(usage.map(e=>e.sessionId));
 const agent=(sessionId:string)=>graph.sessions.find(s=>s.id===sessionId)?.agentId??sessionId.slice(0,8);
 const group=(edges:typeof usage)=>Object.entries(Object.groupBy(edges,e=>e.sessionId)).map(([sessionId,items])=>({sessionId,agentId:agent(sessionId),calls:items!.length,resources:[...new Set(items!.map(e=>e.resourceId).filter(Boolean))],evidenceIds:items!.map(e=>e.id)}));
 const neverUsed=graph.edges.filter(e=>e.kind==='configured'&&!used.has(e.sessionId)).map(e=>({sessionId:e.sessionId,agentId:agent(e.sessionId)}));
 return {toolId,toolVersion,key:`${toolId}@${toolVersion}`,quarantined:service.policy().quarantined.includes(`${toolId}@${toolVersion}`),policyVersion:graph.policyVersion,at:graph.at,
  exposed:group(executed),attempted:group(blocked),baseline:group(baseline),neverUsed,
  other:{held:usage.filter(e=>e.kind==='held'||e.kind==='denied').length,unknown:usage.filter(e=>e.kind==='unknown'||e.kind==='inflight').length},
  summary:{exposedAgents:new Set(executed.map(e=>e.sessionId)).size,exposedCalls:executed.length,blockedAttempts:blocked.length,neverUsedAgents:neverUsed.length,baselineCalls:baseline.length,
   restrictedDataExposed:executed.some(e=>e.resourceId==='customer-logs'),resourcesExposed:[...new Set(executed.map(e=>e.resourceId).filter(Boolean))]},
  sideEffects:0};
}

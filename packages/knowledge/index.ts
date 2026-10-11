import {createHash} from 'node:crypto';
import type {Precedent} from '../../apps/server/service.js';
import {evaluate} from '../policy-engine/index.js';
import {classificationOf,findTable,queryWarehouse,type Department} from '../warehouse/index.js';
import {voyageRerank} from '../playbooks/index.js';
import type {Action,Policy} from '../contracts/index.js';

// Agent memory for warehouse questions. Agent learning produces a candidate; only a
// user approval stores it, and only after the checkpoint passes. Entries are scoped to
// one department and are never served to other departments.
export interface MemoryCandidate{id:string;demoRunId:string;tenantId:string;department:Department|null;sessionId:string;sourceRunId:string;priorRunIds:string[];question:string;table:string;definitions:string;classification:string;
 status:'PROPOSED'|'DENIED'|'APPROVED'|'REJECTED';checkpoint:{allowed:boolean;code:string;reason:string};at:number;knowledgeId?:string;decidedAt?:number;decidedBy?:string}
export interface Knowledge{id:string;demoRunId:string;tenantId:string;department:Department;question:string;table:string;definitions:string;classification:string;scope:'department';
 status:'VALID'|'NEEDS_REVALIDATION';policyVersion:number;approvedBy:string;approvedAt:number;sourceRunId:string;candidateId:string;priorRunIds:string[];invalidatedByVersion?:number}

const conflict=(message:string)=>Object.assign(new Error(message),{status:409});
// Checkpoint: policy checks that run before any agent memory write.
export function checkpoint(input:{table:string;department:Department|null|undefined;scope:string}){
 const classification=classificationOf(input.table);
 if(!classification)return {allowed:false,code:'CHECKPOINT-TABLE-01',reason:'The table is not in the governed catalog.'};
 if(!input.department)return {allowed:false,code:'CHECKPOINT-DEPT-01',reason:'Choose your department before saving agent memory.'};
 if(input.scope!=='department')return {allowed:false,code:'CHECKPOINT-SCOPE-01',reason:'Agent memory can only be shared with your own department.'};
 if(classification==='finance-restricted'&&input.department!=='finance')return {allowed:false,code:'CHECKPOINT-FIN-01',reason:'This table is finance-restricted. It cannot be stored in agent memory outside the finance department.'};
 return {allowed:true,code:'CHECKPOINT-OK',reason:`Classification ${classification}; scope limited to the ${input.department} department.`};
}
// After a governed warehouse run answered with a user-supplied table, propose an entry.
export function proposeFromRun(service:Precedent,runId:string,hint:{table:string;definitions?:string;previousRunId?:string}){
 const run=service.store.get('run',runId);if(!run||run.mode!=='governed'||run.scenario!=='warehouse'||run.status!=='FINISHED')return null;
 const session=service.store.get('session',run.sessionId);if(!session||!service.sessionIsCurrent(session))return null;
 const answered=(run.executionIds??[]).flatMap((id:string)=>[service.store.get('execution',id),service.store.get('execution',id+':resume')]).some((e:any)=>e&&e.status==='SUCCEEDED'&&e.receiptId&&e.action.toolId==='warehouse.query'&&e.action.target===hint.table&&queryWarehouse(hint.table).rowCount>0);
 if(!answered)return null;
 const department=(session.department??null) as Department|null;
 const learned=service.store.all<Knowledge>('knowledge').some(k=>k.demoRunId===service.demo().demoRunId&&k.tenantId===session.tenantId&&k.department===department&&k.table===hint.table&&k.status==='VALID');
 if(learned)return null;
 const result=checkpoint({table:hint.table,department,scope:'department'});
 const prior=hint.previousRunId&&service.store.get('run',hint.previousRunId)?.mode==='governed'?[hint.previousRunId]:[];
 const candidate:MemoryCandidate={id:'memory-'+createHash('sha256').update(runId+hint.table).digest('hex').slice(0,16),demoRunId:service.demo().demoRunId,tenantId:session.tenantId??'acme-demo',department,sessionId:run.sessionId,sourceRunId:runId,priorRunIds:prior,
  question:String(run.task).slice(0,500),table:hint.table,definitions:(hint.definitions??'').slice(0,1000),classification:findTable(hint.table)!.classification,status:result.allowed?'PROPOSED':'DENIED',checkpoint:result,at:service.clock()};
 service.record('memory_candidate',candidate);service.record('run',{...run,memoryCandidateId:candidate.id});
 service.emit(result.allowed?'memory.candidate.proposed':'memory.checkpoint.denied',{runId,sessionId:run.sessionId,candidateId:candidate.id,code:result.code,department});
 return candidate;
}
// User approval: re-runs the checkpoint, then stores a department-scoped entry.
export function approveCandidate(service:Precedent,id:string,scope:string,approvedBy:string){
 const candidate=service.store.get<MemoryCandidate>('memory_candidate',id);if(!candidate)throw Object.assign(new Error('Unknown memory proposal'),{status:404});
 if(candidate.status!=='PROPOSED')throw conflict('This memory proposal is already '+candidate.status.toLowerCase());
 const session=service.requireCurrentSession(candidate.sessionId);
 const result=checkpoint({table:candidate.table,department:session.department??null,scope});
 if(!result.allowed){service.record('memory_candidate',{...candidate,status:'DENIED',checkpoint:result,decidedAt:service.clock(),decidedBy:approvedBy});service.emit('memory.checkpoint.denied',{sessionId:candidate.sessionId,candidateId:id,code:result.code});throw conflict(result.reason);}
 const knowledge:Knowledge={id:'knowledge-'+id.slice(7),demoRunId:candidate.demoRunId,tenantId:candidate.tenantId,department:session.department,question:candidate.question,table:candidate.table,definitions:candidate.definitions,classification:candidate.classification,scope:'department',
  status:'VALID',policyVersion:service.policy().version,approvedBy,approvedAt:service.clock(),sourceRunId:candidate.sourceRunId,candidateId:id,priorRunIds:candidate.priorRunIds};
 service.record('knowledge',knowledge);service.record('memory_candidate',{...candidate,status:'APPROVED',knowledgeId:knowledge.id,decidedAt:service.clock(),decidedBy:approvedBy});
 service.emit('knowledge.saved',{sessionId:candidate.sessionId,knowledgeId:knowledge.id,department:knowledge.department,table:knowledge.table});
 return knowledge;
}
export function rejectCandidate(service:Precedent,id:string,decidedBy:string){
 const candidate=service.store.get<MemoryCandidate>('memory_candidate',id);if(!candidate)throw Object.assign(new Error('Unknown memory proposal'),{status:404});
 if(candidate.status!=='PROPOSED')throw conflict('This memory proposal is already '+candidate.status.toLowerCase());
 service.record('memory_candidate',{...candidate,status:'REJECTED',decidedAt:service.clock(),decidedBy});service.emit('memory.candidate.rejected',{sessionId:candidate.sessionId,candidateId:id});return {...candidate,status:'REJECTED'};
}
// Department filter happens before any ranking or external call.
export function departmentKnowledge(service:Precedent,tenantId:string,department:Department|null|undefined){
 if(!department)return [];
 return service.store.all<Knowledge>('knowledge').filter(k=>k.demoRunId===service.demo().demoRunId&&k.status==='VALID'&&k.tenantId===tenantId&&k.department===department);
}
export const knowledgeText=(k:Knowledge)=>`Question: ${k.question}\nTable: ${k.table}${k.definitions?`\nDefinitions: ${k.definitions}`:''}`;
const words=(text:string)=>new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g)??[]);
export async function rankKnowledge(task:string,entries:Knowledge[],key=process.env.VOYAGE_API_KEY,fetcher:typeof fetch=fetch,topK=2){
 if(!entries.length)return {entries:[] as Knowledge[],engine:'none',degraded:false};
 if(key){try{return {entries:(await voyageRerank(key,fetcher,task,entries.map(knowledgeText),topK,0.4)).map(index=>entries[index]),engine:'voyage-rerank',degraded:false};}catch{/* fall through to labelled keyword matching */}}
 const query=words(task);
 const ranked=entries.map(k=>{const doc=words(knowledgeText(k));let hits=0;for(const word of query)if(doc.has(word))hits++;return {k,score:hits/Math.max(1,query.size)};}).filter(item=>item.score>=0.2).sort((a,b)=>b.score-a.score).slice(0,topK).map(item=>item.k);
 return {entries:ranked,engine:'keyword',degraded:Boolean(key)};
}
export const knowledgeContext=(k:Knowledge)=>({id:k.id,question:k.question,table:k.table,definitions:k.definitions||null,approvedForDepartment:k.department,provenUnderPolicyVersion:k.policyVersion,note:'Approved agent memory for your department. Use this table; current policy still decides every query.'});
// Entries are advice proven under one policy; a change that blocks their table re-validates them.
export function revalidateKnowledge(service:Precedent,policy:Policy){
 for(const k of service.store.all<Knowledge>('knowledge')){
  if(k.status!=='VALID'||k.demoRunId!==service.demo().demoRunId)continue;
  const probe:Action={actorId:'engineer-1',agentId:'memory-check',sessionId:'memory-check',toolId:'warehouse.query',resourceId:'warehouse',environment:'production',target:k.table,department:k.department};
  if(evaluate(probe,policy,[],service.clock()).verdict!=='ALLOW'){service.record('knowledge',{...k,status:'NEEDS_REVALIDATION',invalidatedByVersion:policy.version});service.emit('knowledge.invalidated',{knowledgeId:k.id,version:policy.version});}
 }
}
// Measured: the learning runs (failed attempt + hinted answer) vs the latest reuse.
export function knowledgeComparison(service:Precedent,id:string){
 const k=service.store.get<Knowledge>('knowledge',id);if(!k)throw Object.assign(new Error('Unknown agent memory entry'),{status:404});
 const measure=(runs:Record<string,any>[])=>{if(!runs.length)return null;const executions=runs.flatMap(run=>(run.executionIds??[]).map((e:string)=>service.store.get('execution',e)).filter(Boolean));
  const queries=executions.filter((e:any)=>e.action.toolId==='warehouse.query');const tokens=runs.map(run=>run.metrics?.inputTokens==null?null:run.metrics.inputTokens+(run.metrics.outputTokens??0));
  return {runs:runs.length,department:runs[0].department??null,queries:queries.length,emptyResults:queries.filter((e:any)=>e.status==='SUCCEEDED'&&queryWarehouse(e.action.target).rowCount===0).length,blocked:queries.filter((e:any)=>e.status==='BLOCKED').length,
   userInterventions:runs.filter(run=>run.hint).length,tokens:tokens.every(t=>t!=null)?tokens.reduce((a,b)=>a!+b!,0):null,durationMs:runs.reduce((sum,run)=>sum+(run.durationMs??0),0)};};
 const learning=[...k.priorRunIds,k.sourceRunId].map(runId=>service.store.get('run',runId)).filter(Boolean) as Record<string,any>[];
 const reuses=service.store.all('run').filter(run=>run.knowledgeIds?.includes(id)&&run.status==='FINISHED').sort((a,b)=>a.createdAt-b.createdAt);
 return {knowledge:k,learning:measure(learning),reuse:measure(reuses.slice(-1)),reuseCount:reuses.length,source:'Recorded runs; tokens are provider-reported and missing values stay null.'};
}

import {createHash} from 'node:crypto';
import type {Precedent} from '../../apps/server/service.js';
import {evaluate} from '../policy-engine/index.js';
import type {Action,Policy} from '../contracts/index.js';
import type {MemoryScope} from '../retrieval/scope.js';

export interface PlaybookStep{toolId:Action['toolId'];resourceId:Action['resourceId'];environment:Action['environment'];verdictAtSave:string;ruleId:string;purpose?:string;finding?:string}
export interface PlaybookAvoid{toolId:Action['toolId'];ruleId:string;reason:string}
export interface Playbook{
 id:string;demoRunId:string;tenantId:string;visibleRoles:string[];title:string;taskSummary:string;
 steps:PlaybookStep[];avoid:PlaybookAvoid[];policyVersion:number;sourceRunId:string;evidenceIds:string[];
 status:'VALID'|'NEEDS_REVALIDATION';invalidatedByVersion?:number;invalidationReason?:string;
 index:{engine:'atlas-agent-engine'|'precedent-local';status:'PENDING'|'INDEXED'|'LOCAL_ONLY'|'INDEX_FAILED'};at:number;
}
// Semantic index for playbooks. Precedent's store stays authoritative; an index
// only ranks candidate ids, which are rechecked against scope and status.
export interface PlaybookIndex{engine:'atlas-agent-engine'|'voyage-rerank';save?(playbook:Playbook):Promise<void>;discover(task:string,tenantId:string,topK:number,candidates:Playbook[]):Promise<string[]>}
// Voyage reranking over the authoritative candidates stored in Atlas. Only procedures
// whose relevance clears the threshold are suggested; failures fall back to local ranking.
// Shared Voyage rerank call: returns candidate indexes whose relevance clears the threshold.
export async function voyageRerank(key:string,fetcher:typeof fetch,query:string,documents:string[],topK:number,threshold:number){
 const response=await fetcher('https://api.voyageai.com/v1/rerank',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.VOYAGE_RERANK_MODEL??'rerank-2.5-lite',query,documents,top_k:Math.min(topK,documents.length)}),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw new Error('Voyage rerank failed');
 const body=await response.json() as {data?:{index:number;relevance_score:number}[]};if(!Array.isArray(body.data))throw new Error('Invalid rerank response');
 return body.data.filter(item=>Number.isInteger(item.index)&&item.index>=0&&item.index<documents.length&&Number.isFinite(item.relevance_score)&&item.relevance_score>=threshold).sort((a,b)=>b.relevance_score-a.relevance_score).map(item=>item.index);
}
export function voyagePlaybookRanker(key=process.env.VOYAGE_API_KEY,fetcher:typeof fetch=fetch,threshold=0.4):PlaybookIndex|undefined{
 if(!key)return undefined;
 return {engine:'voyage-rerank',async discover(task,_tenantId,topK,candidates){return (await voyageRerank(key,fetcher,task,candidates.map(playbookInstructions),topK,threshold)).map(index=>candidates[index].id);}};
}

const probe=(step:Pick<PlaybookStep,'toolId'|'resourceId'|'environment'>):Action=>({actorId:'engineer-1',agentId:'playbook-check',sessionId:'playbook-check',...step});
// Identity of a procedure is its proven steps; a later run that followed the same
// steps (and so hit nothing to avoid) is the same playbook, not a new one.
const signature=(steps:Pick<PlaybookStep,'toolId'|'resourceId'|'environment'>[])=>JSON.stringify(steps.map(({toolId,resourceId,environment})=>({toolId,resourceId,environment})));

// Distill a finished governed run into a reusable procedure: keep the steps that
// actually succeeded with a confirmed receipt; record blocked attempts as "avoid".
export function distillPlaybook(service:Precedent,runId:string,indexStatus:Playbook['index']['status']='PENDING'):Playbook|null{
 const run=service.store.get('run',runId);if(!run||run.mode!=='governed'||run.status!=='FINISHED'||!run.memoryEpisodeId)return null;
 // Warehouse learning is department-scoped and human-approved; it never becomes a tenant-wide playbook.
 if(run.scenario==='warehouse')return null;
 const episode=service.store.get('episode',run.memoryEpisodeId);if(!episode?.outcomes?.length)return null;
 const session=service.store.get('session',run.sessionId);if(!session||!service.sessionIsCurrent(session))return null;
 const policy=service.policy();const seen=new Set<string>();const steps:PlaybookStep[]=[];const avoid:PlaybookAvoid[]=[];
 // The model's stated purpose for each planned step, matched by execution order.
 const purpose=(executionId:string)=>{const index=(run.executionIds??[]).indexOf(executionId.replace(/:resume$/,''));const text=run.structuredPlan?.steps?.[index]?.purpose;return typeof text==='string'&&text.trim()?text.trim().slice(0,300):undefined;};
 for(const outcome of episode.outcomes){
  const key=outcome.action.toolId+'|'+outcome.action.resourceId+'|'+outcome.action.environment;
  if(outcome.status==='SUCCEEDED'&&outcome.receiptId&&!seen.has(key)){seen.add(key);const decision=evaluate(probe(outcome.action),policy,[],service.clock());steps.push({toolId:outcome.action.toolId,resourceId:outcome.action.resourceId,environment:outcome.action.environment,verdictAtSave:decision.verdict,ruleId:decision.ruleId,purpose:purpose(outcome.executionId),finding:outcome.result?String(outcome.result).slice(0,400):undefined});}
  if(outcome.status==='BLOCKED'&&!avoid.some(item=>item.toolId===outcome.action.toolId))avoid.push({toolId:outcome.action.toolId,ruleId:outcome.ruleId,reason:outcome.reason});
 }
 if(!steps.length)return null;
 const tenantId=session.tenantId??'acme-demo';
 const duplicate=service.store.all<Playbook>('playbook').find(p=>p.demoRunId===service.demo().demoRunId&&p.tenantId===tenantId&&p.status==='VALID'&&signature(p.steps)===signature(steps));
 if(duplicate)return null;
 const id='playbook-'+createHash('sha256').update(JSON.stringify({runId,steps,avoid})).digest('hex').slice(0,16);
 const playbook:Playbook={id,demoRunId:service.demo().demoRunId,tenantId,visibleRoles:['employee','admin'],title:String(run.task).slice(0,120),taskSummary:String(run.task),steps,avoid,policyVersion:policy.version,sourceRunId:runId,evidenceIds:episode.evidenceIds??[],status:'VALID',index:{engine:'precedent-local',status:indexStatus},at:service.clock()};
 service.record('playbook',playbook);service.record('run',{...run,playbookSavedId:id});service.emit('playbook.saved',{runId,sessionId:run.sessionId,playbookId:id,steps:steps.length,avoid:avoid.length});
 return playbook;
}
export function candidatePlaybooks(service:Precedent,scope:MemoryScope){
 return service.store.all<Playbook>('playbook').filter(p=>p.demoRunId===service.demo().demoRunId&&p.status==='VALID'&&p.tenantId===scope.tenantId&&p.visibleRoles.includes(scope.role));
}
const words=(text:string)=>new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g)??[]);
// Local fallback ranking: word overlap between the task and the stored procedure.
export function rankLocally(task:string,candidates:Playbook[],topK:number){
 const query=words(task);
 return candidates.map(p=>{const doc=words(p.title+' '+p.taskSummary+' '+p.steps.map(s=>s.toolId.replace(/[._]/g,' ')).join(' '));let overlap=0;for(const word of query)if(doc.has(word))overlap++;return {p,score:overlap/Math.max(1,query.size)};})
  .filter(item=>item.score>=0.2).sort((a,b)=>b.score-a.score).slice(0,topK).map(item=>item.p);
}
export async function discoverPlaybooks(task:string,candidates:Playbook[],tenantId:string,index?:PlaybookIndex,topK=2):Promise<{playbooks:Playbook[];engine:string;degraded:boolean}>{
 if(!candidates.length)return {playbooks:[],engine:index?.engine??'precedent-local',degraded:false};
 if(index){
  try{const byId=new Map(candidates.map(p=>[p.id,p]));const ids=await index.discover(task,tenantId,topK*3,candidates);const found=ids.map(id=>byId.get(id)).filter((p):p is Playbook=>Boolean(p)).slice(0,topK);return {playbooks:found,engine:index.engine,degraded:false};}
  catch{return {playbooks:rankLocally(task,candidates,topK),engine:'precedent-local',degraded:true};}
 }
 return {playbooks:rankLocally(task,candidates,topK),engine:'precedent-local',degraded:false};
}
// Playbooks are advice proven under one policy version. When policy changes,
// any step whose decision would now differ marks the playbook for re-validation.
export function revalidatePlaybooks(service:Precedent,policy:Policy){
 for(const p of service.store.all<Playbook>('playbook')){
  if(p.status!=='VALID'||p.demoRunId!==service.demo().demoRunId)continue;
  const changed=p.steps.find(step=>evaluate(probe(step),policy,[],service.clock()).verdict!==step.verdictAtSave);
  if(changed){service.record('playbook',{...p,status:'NEEDS_REVALIDATION',invalidatedByVersion:policy.version,invalidationReason:`Policy v${policy.version} changes the decision for ${changed.toolId}.`});service.emit('playbook.invalidated',{playbookId:p.id,version:policy.version,toolId:changed.toolId});}
 }
}
// The full written procedure: ordered steps with their purpose and the finding each
// produced, actions to avoid, and the policy version it was proven under.
export function playbookInstructions(p:Playbook){
 return [`Procedure: ${p.title}`,`Learned from a governed run under policy v${p.policyVersion}. Advice only; current policy decides every step.`,'Steps, in order:',
  ...p.steps.map((s,i)=>`${i+1}. ${s.toolId} on ${s.resourceId} (${s.environment})${s.purpose?` — ${s.purpose}`:''}${s.finding?`\n   Finding last time: ${s.finding}`:''}`),
  ...(p.avoid.length?['Avoid:',...p.avoid.map(a=>`- ${a.toolId}: ${a.reason} (${a.ruleId})`)]:[]),
  'Run every step in order; each one supplies evidence the next step relies on.'].join('\n');
}
export const playbookContext=(p:Playbook)=>({id:p.id,title:p.title,instructions:playbookInstructions(p),steps:p.steps.map(({toolId,resourceId,environment,purpose,finding})=>({toolId,resourceId,environment,purpose:purpose??null,findingLastTime:finding??null})),avoid:p.avoid,provenUnderPolicyVersion:p.policyVersion,note:'Advice from an earlier successful run. Every step is still checked by current policy.'});
// Measured comparison: the run the playbook came from vs the latest run that used it.
export function playbookComparison(service:Precedent,id:string){
 const p=service.store.get<Playbook>('playbook',id);if(!p)throw Object.assign(new Error('Unknown playbook'),{status:404});
 const measure=(run:Record<string,any>|undefined)=>{if(!run)return null;const executions=(run.executionIds??[]).map((e:string)=>service.store.get('execution',e)).filter(Boolean);
  const findings=new Set(executions.filter((e:any)=>e.status==='SUCCEEDED'&&e.receiptId).map((e:any)=>e.action.toolId));
  return {runId:run.id,task:run.task,status:run.status,memory:run.memoryMode??'full',matchedBy:run.context?.playbookRetrieval?.engine??null,steps:executions.length,blocked:executions.filter((e:any)=>e.status==='BLOCKED').length,findings:findings.size,tools:executions.map((e:any)=>({toolId:e.action.toolId,status:e.status})),inputTokens:run.metrics?.inputTokens??null,outputTokens:run.metrics?.outputTokens??null,durationMs:run.durationMs??null,usedPlaybook:Boolean(run.playbookIds?.includes(id))};};
 const users=service.store.all('run').filter(run=>run.playbookIds?.includes(id)&&run.status==='FINISHED').sort((a,b)=>a.createdAt-b.createdAt);
 return {playbook:p,before:measure(service.store.get('run',p.sourceRunId)),after:measure(users.at(-1)),uses:users.length,source:'Recorded runs; tokens are provider-reported usage and missing values stay null.'};
}

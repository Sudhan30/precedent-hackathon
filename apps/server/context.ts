import {Precedent} from './service.js';
import {memoryStore,type DomainRuntime} from './runtime.js';
import {retrieveContext,type RetrievalOptions} from '../../packages/retrieval/index.js';
import {policyDocuments} from '../../packages/policies/index.js';
import {visibleEpisode} from '../../packages/retrieval/scope.js';

const conflict=()=>Object.assign(new Error('Policy or memory scope changed during retrieval; retry the task'),{status:409});

// Only snapshot reads and cache writes run in retryable database transactions.
// Provider calls use detached, already scoped records and execute once per request.
export async function retrieveForRuntime(runtime:DomainRuntime,sessionId:string,resourceId:string,task:string,options:RetrievalOptions={}){
 const read=runtime.read?runtime.read.bind(runtime):runtime.run.bind(runtime);
 // Read-only snapshot outside the write queue; scope is rechecked afterwards.
 const snapshot=await read(service=>{
  const scope=service.memoryScope(sessionId),policy=service.policy();
  const session=service.store.get('session',sessionId)!;
  const rules=policyDocuments(policy,scope.tenantId).map(expected=>service.store.get('policy_rule',expected.id)??expected);
  const initial=new Map<string,Map<string,any>>([
   ['metadata',new Map([['demo',service.demo()]])],
   ['policy',new Map([['head',policy]])],
   ['session',new Map([[sessionId,session]])],
   ['episode',new Map(service.memoryCandidates(sessionId,resourceId).map(record=>[record.id,record]))],
   ['policy_rule',new Map(rules.map(record=>[record.id,record]))]
  ]);
  return {initial:structuredClone(initial),scope,policy,principalId:session.principalId};
 });
 const detached=memoryStore(snapshot.initial);
 const context=await retrieveContext(new Precedent(detached.store),sessionId,resourceId,task,{search:runtime.searchEpisodes,searchPolicies:runtime.searchPolicies,...options});
 // Recheck scope in a transaction only when embeddings must be cached; otherwise read-only.
 return (detached.changes.size?runtime.run.bind(runtime):read)(service=>service.store.atomic(()=>{
  const scope=service.memoryScope(sessionId),session=service.store.get('session',sessionId)!;
  if(service.policy().version!==snapshot.policy.version||scope.tenantId!==snapshot.scope.tenantId||scope.role!==snapshot.scope.role||session.principalId!==snapshot.principalId)throw conflict();
  for(const episode of context.episodes){
   const current=service.store.get('episode',episode.id);
   if(!current||current.supersededBy||!visibleEpisode(current,scope,sessionId,resourceId)||current.summary!==episode.summary)throw conflict();
  }
  const canonical=policyDocuments(service.policy(),scope.tenantId);
  for(const [key,record] of detached.changes){
   const [kind,id]=key.split('\0');
   const current=service.store.get(kind,id);
   if(kind==='episode'){
    if(!current||current.supersededBy||!visibleEpisode(current,scope,sessionId,resourceId)||current.summary!==record.summary)continue;
   }else if(kind==='policy_rule'){
    const expected=canonical.find(rule=>rule.id===id);
    if(!expected||expected.summary!==record.summary||record.policyVersion!==snapshot.policy.version)continue;
   }else continue;
   // Merge cache fields into current records; never restore snapshot metadata.
   service.record(kind,{...current,...(kind==='policy_rule'?canonical.find(rule=>rule.id===id):{}),...(Array.isArray(record.embedding)?{embedding:record.embedding,embeddingModel:record.embeddingModel}:{})});
  }
  return context;
 }));
}

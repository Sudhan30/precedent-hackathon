import {z} from 'zod';
import {policySchema,describeRules,policyDocuments} from '../policies/index.js';
import type {Precedent} from '../../apps/server/service.js';
import type {EpisodeSearch,PolicySearch} from './atlas.js';
import {visibleEpisode} from './scope.js';
const embeddingResponse=z.object({data:z.array(z.object({index:z.number().int().nonnegative(),embedding:z.array(z.number().finite()).min(1)}))});
const rerankResponse=z.object({data:z.array(z.object({index:z.number().int().nonnegative(),relevance_score:z.number().finite()}))});
export interface RetrievalOptions{key?:string;fetcher?:typeof fetch;search?:EpisodeSearch;searchPolicies?:PolicySearch;}
export async function retrieveContext(service:Precedent,sessionId:string,resourceId:string,task:string,options:RetrievalOptions={}){
 const policy=policySchema.parse(service.policy()),scope=service.memoryScope(sessionId),currentRules=describeRules(policy);
 const candidates=service.memoryCandidates(sessionId,resourceId).slice(-30);
 const rules=policyDocuments(policy,scope.tenantId).map(expected=>{
  const saved=service.store.get('policy_rule',expected.id);
  if(saved&&saved.summary===expected.summary&&saved.ruleId===expected.ruleId&&saved.tenantId===scope.tenantId&&saved.policyVersion===policy.version&&saved.visibleRoles?.includes(scope.role))return saved;
  service.record('policy_rule',expected);return expected;
 });
 const words=new Set(task.toLowerCase().match(/[a-z0-9]+/g)??[]);
 const lexical=(text:string)=>(text.toLowerCase().match(/[a-z0-9]+/g)??[]).reduce((score,word)=>score+(words.has(word)?1:0),0);
 let episodes=candidates.map(e=>({...e,historical:(e.policyVersions??[e.policyVersion]).some((version:number)=>version!==policy.version)})).sort((a,b)=>lexical(b.summary)-lexical(a.summary)||b.at-a.at).slice(0,5);
 let semanticMemory=rules.toSorted((a,b)=>lexical(b.summary)-lexical(a.summary)).map(rule=>({id:rule.id,ruleId:rule.ruleId,description:rule.summary,policyVersion:rule.policyVersion}));
 let retrieval={mode:'lexical',degraded:true,reason:'Voyage not configured; authoritative rules remain active'};
 const key=options.key??process.env.VOYAGE_API_KEY,fetcher=options.fetcher??fetch;
 const request=async(endpoint:string,body:object)=>{const r=await fetcher('https://api.voyageai.com/v1/'+endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw new Error('Voyage request failed');return r.json();};
 if(key){try{
  const model=process.env.VOYAGE_EMBEDDING_MODEL??'voyage-4-lite';
  const documents=[...candidates.map(record=>({kind:'episode',record})),...rules.map(record=>({kind:'policy_rule',record}))];
  const missing=documents.filter(({record})=>record.embeddingModel!==model||!Array.isArray(record.embedding));
  if(missing.length){const {data}=embeddingResponse.parse(await request('embeddings',{model,input:missing.map(({record})=>record.summary),input_type:'document',output_dimension:1024}));if(data.length!==missing.length||new Set(data.map(item=>item.index)).size!==missing.length)throw new Error('Incomplete embeddings');for(const item of data){const document=missing[item.index];if(!document)throw new Error('Invalid embedding index');document.record.embedding=item.embedding;document.record.embeddingModel=model;service.record(document.kind,document.record);}}
  const {data}=embeddingResponse.parse(await request('embeddings',{model,input:[task],input_type:'query',output_dimension:1024}));if(data.length!==1||data[0].index!==0)throw new Error('Invalid query embedding');const query=data[0].embedding;
  const cosine=(embedding:number[])=>{if(embedding.length!==query.length)throw new Error('Embedding dimension mismatch');let dot=0,a=0,b=0;for(let i=0;i<query.length;i++){dot+=embedding[i]*query[i];a+=embedding[i]**2;b+=query[i]**2;}return a&&b?dot/Math.sqrt(a*b):0;};
  let hybrid=documents.map(document=>({...document,score:cosine(document.record.embedding)+lexical(document.record.summary)/10})).sort((a,b)=>b.score-a.score).slice(0,15).map(({kind,record})=>({kind,record}));
  let atlasUsed=false,atlasFailed=false;
  const native:typeof hybrid=[];
  if(options.search){try{const ids=await options.search({...scope,sessionId,resourceId,task,embedding:query,embeddingModel:model});for(const id of ids){const record=service.store.get('episode',id);if(record&&!record.supersededBy&&service.episodeIsCurrent(record)&&visibleEpisode(record,scope,sessionId,resourceId))native.push({kind:'episode',record});}atlasUsed=true;}catch{atlasFailed=true;}}
  if(options.searchPolicies){try{const ids=await options.searchPolicies({...scope,policyVersion:policy.version,task,embedding:query,embeddingModel:model});for(const id of ids){const record=rules.find(rule=>rule.id===id);if(record)native.push({kind:'policy_rule',record});}atlasUsed=true;}catch{atlasFailed=true;}}
  hybrid=[...new Map([...native,...hybrid].map(document=>[document.kind+':'+document.record.id,document])).values()].slice(0,15);
  const ranked=rerankResponse.parse(await request('rerank',{model:process.env.VOYAGE_RERANK_MODEL??'rerank-2.5-lite',query:task,documents:hybrid.map(({record})=>record.summary),top_k:Math.min(8,hybrid.length)}));
  if(new Set(ranked.data.map(item=>item.index)).size!==ranked.data.length)throw new Error('Duplicate rerank index');
  const selected=ranked.data.map(item=>{if(!hybrid[item.index])throw new Error('Invalid rerank index');return hybrid[item.index];});
  episodes=selected.filter(document=>document.kind==='episode').slice(0,5).map(({record})=>({...record,historical:(record.policyVersions??[record.policyVersion]).some((version:number)=>version!==policy.version)}));
  semanticMemory=selected.filter(document=>document.kind==='policy_rule').slice(0,5).map(({record})=>({id:record.id,ruleId:record.ruleId,description:record.summary,policyVersion:record.policyVersion}));
  retrieval={mode:atlasUsed?'Atlas lexical + vector search + Voyage reranking':'Voyage embeddings + lexical + reranking',degraded:atlasFailed,reason:atlasFailed?'Atlas search unavailable; local hybrid fallback used with current rules':'Relevant persisted episodes and policy descriptions ranked before planning'};
 }catch{retrieval={mode:'lexical',degraded:true,reason:'Semantic retrieval unavailable; authoritative rules remain active'};}}
 return {policy,currentRules,semanticMemory,episodes:episodes.map(({embedding,embeddingModel,...e})=>e),retrieval,scope};
}

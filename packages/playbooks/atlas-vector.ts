import {z} from 'zod';
import type {Document} from 'mongodb';
import {playbookInstructions,voyageRerank,type Playbook,type PlaybookIndex} from './index.js';
// Playbook vectors live in their own collection, outside the transactional snapshot,
// so embeddings never travel with /api/state. The playbook record stays authoritative.
export const playbookVectorCollection='playbook_vectors';
export const playbookVectorIndex={name:'precedent_playbook_vector',type:'vectorSearch',definition:{fields:[{type:'vector',path:'embedding',numDimensions:1024,similarity:'cosine'},...['tenantId','playbookId','embeddingModel'].map(path=>({type:'filter',path}))]}};
export interface PlaybookVectorCollection{
 aggregate(pipeline:Document[],options:{maxTimeMS:number}):{toArray():Promise<Document[]>};
 find(filter:Document,options:{projection:Document}):{toArray():Promise<Document[]>};
 updateOne(filter:Document,update:Document,options:{upsert:boolean}):Promise<unknown>;
}
const embeddingResponse=z.object({data:z.array(z.object({index:z.number().int().nonnegative(),embedding:z.array(z.number().finite()).length(1024)}))});
// Two stages: Atlas $vectorSearch retrieves the nearest stored procedures within the
// candidate ids, then Voyage rerank keeps only those that clear the relevance threshold.
// Procedures saved moments ago may not be indexed yet; they go straight to reranking.
export function atlasPlaybookIndex(collection:PlaybookVectorCollection,key=process.env.VOYAGE_API_KEY,fetcher:typeof fetch=fetch,threshold=0.4):PlaybookIndex|undefined{
 if(!key)return undefined;
 const model=()=>process.env.VOYAGE_EMBEDDING_MODEL??'voyage-4-lite';
 const embed=async(input:string[],inputType:'query'|'document')=>{
  const response=await fetcher('https://api.voyageai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:model(),input,input_type:inputType,output_dimension:1024}),signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)throw new Error('Voyage embedding failed');
  const {data}=embeddingResponse.parse(await response.json());if(data.length!==input.length)throw new Error('Incomplete embeddings');
  return data.toSorted((a,b)=>a.index-b.index).map(item=>item.embedding);
 };
 const store=async(playbooks:Playbook[])=>{
  if(!playbooks.length)return;const vectors=await embed(playbooks.map(playbookInstructions),'document');
  await Promise.all(playbooks.map((p,i)=>collection.updateOne({_id:p.id},{$set:{playbookId:p.id,tenantId:p.tenantId,demoRunId:p.demoRunId,embedding:vectors[i],embeddingModel:model(),at:Date.now()}},{upsert:true})));
 };
 return {
  engine:'atlas-vector-search',
  save:p=>store([p]),
  async discover(task,tenantId,topK,candidates){
   const ids=candidates.map(p=>p.id),[query]=await embed([task],'query');
   const hits=z.array(z.object({playbookId:z.string()})).parse(await collection.aggregate([{$vectorSearch:{index:playbookVectorIndex.name,path:'embedding',queryVector:query,numCandidates:Math.max(50,topK*10),limit:topK,filter:{tenantId,embeddingModel:model(),playbookId:{$in:ids}}}},{$project:{_id:0,playbookId:1}}],{maxTimeMS:5000}).toArray()).map(hit=>hit.playbookId);
   const stored=new Map((await collection.find({_id:{$in:ids},embeddingModel:model()},{projection:{at:1}}).toArray()).map(row=>[String(row._id),Number(row.at)]));
   // Backfill procedures that have no vector yet (saved before this index existed).
   await store(candidates.filter(p=>!stored.has(p.id))).catch(()=>undefined);
   const unindexed=candidates.filter(p=>!hits.includes(p.id)&&(!stored.has(p.id)||Date.now()-stored.get(p.id)!<120000));
   const pool=[...hits.map(id=>candidates.find(p=>p.id===id)!),...unindexed];if(!pool.length)return [];
   return (await voyageRerank(key,fetcher,task,pool.map(playbookInstructions),topK,threshold)).map(index=>pool[index].id);
  }
 };
}

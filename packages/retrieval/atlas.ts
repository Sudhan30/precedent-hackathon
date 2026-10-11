import {z} from 'zod';
import type {Document} from 'mongodb';
import type {MemoryScope} from './scope.js';
export interface EpisodeSearchInput extends MemoryScope{sessionId:string;resourceId:string;task:string;embedding:number[];embeddingModel:string;}
export type EpisodeSearch=(input:EpisodeSearchInput)=>Promise<string[]>;
export interface PolicySearchInput extends MemoryScope{policyVersion:number;task:string;embedding:number[];embeddingModel:string;}
export type PolicySearch=(input:PolicySearchInput)=>Promise<string[]>;
export interface SearchCollection{aggregate(pipeline:Document[],options:{maxTimeMS:number}):{toArray():Promise<Document[]>};}
export const lexicalIndex={name:'precedent_episode_text',definition:{mappings:{dynamic:false,fields:{summary:{type:'string'},tenantId:{type:'token'},visibleRoles:{type:'token'},resourceId:{type:'token'},sessionId:{type:'token'}}}}};
export const vectorIndex={name:'precedent_episode_vector',type:'vectorSearch',definition:{fields:[{type:'vector',path:'embedding',numDimensions:1024,similarity:'cosine'},...['tenantId','visibleRoles','resourceId','sessionId','embeddingModel'].map(path=>({type:'filter',path}))]}};
export const policyLexicalIndex={name:'precedent_policy_text',definition:{mappings:{dynamic:false,fields:{summary:{type:'string'},tenantId:{type:'token'},visibleRoles:{type:'token'},policyVersion:{type:'number'}}}}};
export const policyVectorIndex={name:'precedent_policy_vector',type:'vectorSearch',definition:{fields:[{type:'vector',path:'embedding',numDimensions:1024,similarity:'cosine'},...['tenantId','visibleRoles','policyVersion','embeddingModel'].map(path=>({type:'filter',path}))]}};
export function episodeProjection(episode:Record<string,any>){
 return {tenantId:episode.tenantId??null,visibleRoles:episode.visibleRoles??[],...(episode.resourceId!==undefined?{resourceId:episode.resourceId}:{}),...(episode.sessionId!==undefined?{sessionId:episode.sessionId}:{}),summary:episode.summary,embedding:episode.embedding??[],embeddingModel:episode.embeddingModel??null};
}
export function atlasPolicySearch(collection:SearchCollection,options:{lexical?:boolean}={}):PolicySearch{
 return async input=>{
  if(input.embedding.length!==1024||input.embedding.some(n=>!Number.isFinite(n)))throw new Error('Atlas query requires a 1024-dimensional embedding');
  const filter={tenantId:input.tenantId,visibleRoles:input.role,policyVersion:input.policyVersion,embeddingModel:input.embeddingModel};
  const pipelines=[
   [{$search:{index:policyLexicalIndex.name,compound:{must:[{text:{query:input.task,path:'summary'}}],filter:['tenantId','visibleRoles','policyVersion'].map(path=>({equals:{path,value:filter[path as 'tenantId'|'visibleRoles'|'policyVersion']}}))}}},{$limit:20},{$project:{_id:0,id:1}}],
   [{$vectorSearch:{index:policyVectorIndex.name,path:'embedding',queryVector:input.embedding,numCandidates:200,limit:20,filter}},{$project:{_id:0,id:1}}]
  ];
  // Compact/free-tier layout uses native policy vectors; the retrieval adapter
  // still scores current policy descriptions lexically before Voyage reranking.
  const rows=await Promise.all((options.lexical===false?pipelines.slice(1):pipelines).map(pipeline=>collection.aggregate(pipeline,{maxTimeMS:5000}).toArray()));const scores=new Map<string,number>();
  for(const row of rows){const seen=new Set<string>();z.array(z.object({id:z.string().min(1)})).parse(row).forEach(({id},rank)=>{if(!seen.has(id))scores.set(id,(scores.get(id)??0)+1/(61+rank));seen.add(id);});}
  return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id])=>id);
 };
}
export function atlasEpisodeSearch(collection:SearchCollection):EpisodeSearch{
 return async input=>{
  if(input.embedding.length!==1024||input.embedding.some(n=>!Number.isFinite(n)))throw new Error('Atlas query requires a 1024-dimensional embedding');
  const filter={tenantId:input.tenantId,visibleRoles:input.role,resourceId:input.resourceId,sessionId:{$ne:input.sessionId},embeddingModel:input.embeddingModel};
  const lexical=[{$search:{index:lexicalIndex.name,compound:{must:[{text:{query:input.task,path:'summary'}}],filter:['tenantId','visibleRoles','resourceId'].map(path=>({equals:{path,value:filter[path as 'tenantId'|'visibleRoles'|'resourceId']}})),mustNot:[{equals:{path:'sessionId',value:input.sessionId}}]}}},{$limit:20},{$project:{_id:0,id:1}}];
  const vector=[{$vectorSearch:{index:vectorIndex.name,path:'embedding',queryVector:input.embedding,numCandidates:200,limit:20,filter}},{$project:{_id:0,id:1}}];
  const rows=await Promise.all([collection.aggregate(lexical,{maxTimeMS:5000}).toArray(),collection.aggregate(vector,{maxTimeMS:5000}).toArray()]);
  const scores=new Map<string,number>();
  for(const result of rows){const validated=z.array(z.object({id:z.string().min(1)})).parse(result);const seen=new Set<string>();validated.forEach(({id},rank)=>{if(!seen.has(id))scores.set(id,(scores.get(id)??0)+1/(60+rank+1));seen.add(id);});}
  return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id])=>id);
 };
}

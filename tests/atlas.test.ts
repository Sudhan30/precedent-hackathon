import {test} from 'node:test';import assert from 'node:assert/strict';
import {atlasEpisodeSearch,atlasPolicySearch,episodeProjection} from '../packages/retrieval/atlas.js';
import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';import {retrieveContext} from '../packages/retrieval/index.js';
test('Atlas pipelines prefilter scope and fuse independent lexical/vector rankings',async()=>{
 const pipelines:any[]=[];const search=atlasEpisodeSearch({aggregate(pipeline,options){pipelines.push(pipeline);assert.equal(options.maxTimeMS,5000);return {async toArray(){return pipelines.length===1?[{id:'a'},{id:'b'}]:[{id:'b'},{id:'c'}];}};}});
 const ids=await search({tenantId:'acme-demo',role:'employee',sessionId:'fresh',resourceId:'customer-logs',task:'checkout',embedding:Array(1024).fill(.1),embeddingModel:'voyage-4-lite'});
 assert.equal(ids[0],'b');const vector=pipelines[1][0].$vectorSearch;
 assert.deepEqual(vector.filter,{tenantId:'acme-demo',visibleRoles:'employee',resourceId:'customer-logs',sessionId:{$ne:'fresh'},embeddingModel:'voyage-4-lite'});
 assert.equal(pipelines[0][0].$search.compound.filter.length,3);assert.equal(pipelines[0][0].$search.compound.mustNot[0].equals.value,'fresh');
 await assert.rejects(search({tenantId:'acme-demo',role:'employee',sessionId:'fresh',resourceId:'customer-logs',task:'checkout',embedding:[1],embeddingModel:'voyage-4-lite'}));
 assert.deepEqual(episodeProjection({summary:'legacy',sessionId:'old',resourceId:'customer-logs'}).visibleRoles,[]);
});
test('Atlas policy search prefilters active version, tenant and role',async()=>{
 const pipelines:any[]=[];const search=atlasPolicySearch({aggregate(pipeline){pipelines.push(pipeline);return {async toArray(){return [{id:'acme-demo:7:DATA-18'}];}};}});
 const ids=await search({tenantId:'acme-demo',role:'employee',policyVersion:7,task:'customer logs',embedding:Array(1024).fill(.1),embeddingModel:'voyage-4-lite'});assert.deepEqual(ids,['acme-demo:7:DATA-18']);
 assert.deepEqual(pipelines[1][0].$vectorSearch.filter,{tenantId:'acme-demo',visibleRoles:'employee',policyVersion:7,embeddingModel:'voyage-4-lite'});assert.ok(pipelines[0][0].$search.compound.filter.some((f:any)=>f.equals.path==='policyVersion'&&f.equals.value===7));
});
test('compact policy search uses a single scoped vector index without requiring native lexical search',async()=>{
 const pipelines:any[]=[];const search=atlasPolicySearch({aggregate(pipeline){pipelines.push(pipeline);return {async toArray(){return [{id:'acme-demo:7:DATA-18'}];}};}},{lexical:false});
 assert.deepEqual(await search({tenantId:'acme-demo',role:'employee',policyVersion:7,task:'customer logs',embedding:Array(1024).fill(.1),embeddingModel:'voyage-4-lite'}),['acme-demo:7:DATA-18']);
 assert.equal(pipelines.length,1);assert.equal(pipelines[0][0].$vectorSearch.index,'precedent_policy_vector');
 assert.deepEqual(pipelines[0][0].$vectorSearch.filter,{tenantId:'acme-demo',visibleRoles:'employee',policyVersion:7,embeddingModel:'voyage-4-lite'});
});
test('Atlas results are rechecked against authoritative scope and search failures visibly degrade',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const writer=service.session();service.execute(service.action(writer.id,'internal_logs.search','customer-logs','production'),'evidence');const episode=store.all('episode')[0];
 store.put('episode',{...episode,id:'foreign',tenantId:'foreign-company',summary:'foreign secret'});const fresh=service.session();
 const sent:string[]=[];const fetcher:typeof fetch=async(url,options)=>{const body=JSON.parse(String(options?.body));sent.push(...(body.documents??[]));return Response.json(String(url).endsWith('/rerank')?{data:body.documents.map((_:string,index:number)=>({index,relevance_score:1}))}:{data:body.input.map((_:string,index:number)=>({index,embedding:Array(1024).fill(.1)}))});};
 const good=await retrieveContext(service,fresh.id,'customer-logs','checkout',{key:'test',fetcher,search:async()=>['foreign',episode.id,'missing']});
 assert.equal(good.retrieval.mode,'Atlas lexical + vector search + Voyage reranking');assert.equal(good.episodes.length,1);assert.ok(!sent.includes('foreign secret'));
 const fallback=await retrieveContext(service,fresh.id,'customer-logs','checkout',{key:'test',fetcher,search:async()=>{throw new Error('index unavailable');}});
 assert.equal(fallback.retrieval.degraded,true);assert.match(fallback.retrieval.reason,/Atlas search unavailable/);assert.equal(fallback.currentRules.length,6);assert.equal(fallback.episodes.length,1);store.close();
});

import {test} from 'node:test';import assert from 'node:assert/strict';import {openStore} from '../apps/server/store.js';import {Precedent} from '../apps/server/service.js';import {retrieveContext} from '../packages/retrieval/index.js';
test('pre-plan packet retains current rules and scoped history when semantic retrieval fails',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const a=service.session();service.execute(service.action(a.id,'internal_logs.search','customer-logs','production'),'evidence');const b=service.session();
 const packet=await retrieveContext(service,b.id,'customer-logs','checkout',{key:'test',fetcher:async()=>{throw new Error('offline');}});assert.equal(packet.retrieval.degraded,true);assert.equal(packet.policy.version,1);assert.equal(packet.currentRules.length,6);assert.equal(packet.episodes[0].evidenceId,'evidence');assert.equal((await retrieveContext(service,b.id,'sandbox-logs','checkout',{key:''})).episodes.length,0);store.close();
});
test('semantic policy memory ranks current descriptions and rejects stale or foreign search IDs',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const original=store.get('policy_version','1');service.publish({...service.policy(),sandboxAllowed:false});const session=service.session();const summaries:string[]=[];
 const fetcher:typeof fetch=async(url,options)=>{const body=JSON.parse(String(options?.body));summaries.push(...(body.input??body.documents??[]));return Response.json(String(url).endsWith('/rerank')?{data:body.documents.slice(0,body.top_k).map((_:string,index:number)=>({index,relevance_score:1}))}:{data:body.input.map((_:string,index:number)=>({index,embedding:Array(1024).fill(.1)}))});};
 const packet=await retrieveContext(service,session.id,'sandbox-logs','sandbox exports',{key:'test',fetcher,searchPolicies:async()=>['acme-demo:1:SANDBOX-04','foreign:2:DATA-18','acme-demo:2:SANDBOX-04']});
 assert.equal(packet.retrieval.degraded,false);assert.equal(packet.currentRules.length,6);assert.equal(packet.semanticMemory.length,5);assert.ok(packet.semanticMemory.every(rule=>rule.policyVersion===2&&rule.id.startsWith('acme-demo:2:')));assert.ok(packet.semanticMemory.some(rule=>rule.description.includes('disabled')));
 assert.deepEqual(store.get('policy_version','1'),original);assert.ok(store.get('policy_rule','acme-demo:2:SANDBOX-04').embedding);assert.equal(packet.episodes.length,0);
 assert.equal(service.execute(service.action(session.id,'demo_export.send','sandbox-logs','sandbox'),'blocked-after-search').status,'BLOCKED');store.close();
});
test('malformed duplicate embedding indices degrade retrieval without dropping mandatory rules',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const session=service.session();const packet=await retrieveContext(service,session.id,'sandbox-logs','sandbox',{key:'test',fetcher:async(_url,options)=>{const body=JSON.parse(String(options?.body));return Response.json({data:body.input.map(()=>({index:0,embedding:[1,0]}))});}});assert.equal(packet.retrieval.degraded,true);assert.equal(packet.currentRules.length,6);assert.equal(packet.semanticMemory.length,6);store.close();
});
test('memory boundaries apply before retrieval and before external embedding requests',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const writer=service.session();service.execute(service.action(writer.id,'internal_logs.search','customer-logs','production'),'public-evidence');
 const base=store.all('episode')[0];
 store.put('episode',{...base,id:'other-tenant',tenantId:'other-company',summary:'tenant-secret'});
 store.put('episode',{...base,id:'admin-only',visibleRoles:['admin'],summary:'admin-secret'});
 store.put('episode',{...base,id:'unscoped',tenantId:undefined,visibleRoles:undefined,summary:'unscoped-secret'});
 const employee=service.session(),admin=service.session({tenantId:'acme-demo',role:'admin'}),other=service.session({tenantId:'other-company',role:'employee'});
 assert.deepEqual(service.memory(employee.id,'customer-logs').map(e=>e.id),[base.id]);
 assert.equal(service.memory(admin.id,'customer-logs').length,2);assert.deepEqual(service.memory(other.id,'customer-logs').map(e=>e.id),['other-tenant']);
 const sent:string[]=[];const fetcher:typeof fetch=async(url,options)=>{const body=JSON.parse(String(options?.body));sent.push(...(body.input??body.documents??[]));return Response.json(String(url).endsWith('/rerank')?{data:[{index:0,relevance_score:1}]}:{data:body.input.map((_:string,index:number)=>({index,embedding:[1,0]}))});};
 const packet=await retrieveContext(service,employee.id,'customer-logs','checkout',{key:'test',fetcher});assert.equal(packet.episodes.length,1);assert.ok(sent.every(s=>!s.includes('secret')));assert.deepEqual(packet.scope,{tenantId:'acme-demo',role:'employee'});
 await assert.rejects(retrieveContext(service,'unknown','customer-logs','checkout',{key:''}));store.close();
});
test('semantic adapter validates responses, persists embeddings and reranks episodes',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const a=service.session();service.execute(service.action(a.id,'internal_logs.search','customer-logs','production'),'evidence');const b=service.session();let calls=0;
 const fetcher:typeof fetch=async(url,options)=>{calls++;const body=JSON.parse(String(options?.body));return Response.json(String(url).endsWith('/rerank')?{data:[{index:0,relevance_score:.99}]}:{data:body.input.map((_:string,index:number)=>({index,embedding:[1,0]}))});};
 const packet=await retrieveContext(service,b.id,'customer-logs','checkout',{key:'test',fetcher});assert.equal(packet.retrieval.degraded,false);assert.equal(calls,3);assert.ok(store.all('episode')[0].embedding);assert.ok(!('embedding' in packet.episodes[0]));store.close();
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {candidatePlaybooks,discoverPlaybooks,voyagePlaybookRanker,type Playbook} from '../packages/playbooks/index.js';

// Test planner: follows a supplied playbook, otherwise tries the external analyzer
// first. It reports provider-style usage so measured metrics can be checked.
const transport={
 health:async()=>({}),
 create:async({message}:{message:string})=>{
  const input=JSON.parse(message),playbook=input.companyContext?.playbooks?.[0];
  const steps=playbook?playbook.steps.map((s:any)=>({toolId:s.toolId,purpose:'Follow the learned playbook',policyReferences:[],memoryReferences:[playbook.id]})):input.resource==='sandbox-logs'?[{toolId:'example_connector.analyze',purpose:'Analyze sandbox',policyReferences:[],memoryReferences:[]}]:[{toolId:'example_connector.analyze',purpose:'External analysis',policyReferences:[],memoryReferences:[]},{toolId:'internal_logs.search',purpose:'Internal search',policyReferences:[],memoryReferences:[]}];
  const usage=playbook?{inputTokens:900,outputTokens:100}:{inputTokens:4000,outputTokens:600};
  return {session:{state:{sessionId:'worker-'+input.runId}},response:{result:async()=>({data:{goal:input.task,reply:'',steps},events:[{type:'step.completed',data:{usage}}]})}};
 }
};
async function harness(){
 const store=openStore(':memory:');const service=new Precedent(store);
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,undefined,transport as any).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body?:unknown,token?:string)=>{const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};};
 const employee=(await call('/login',{role:'employee'})).data.token,admin=(await call('/login',{role:'admin'})).data.token;
 const ask=async(task:string,scenario='investigation',memory='full')=>(await call('/comparison',{task,scenario,planner:'eve',target:'governed',memory},employee)).data.runs[0];
 return {store,service,call,employee,admin,ask,playbooks:()=>store.all<Playbook>('playbook'),close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}

test('a finished governed run is distilled into a playbook of confirmed steps and blocked actions to avoid',async()=>{
 const h=await harness();try{
  const a=await h.ask('Investigate why checkout is failing for customer Globex');assert.equal(a.status,'FINISHED');
  const [playbook]=h.playbooks();
  assert.deepEqual(playbook.steps.map(s=>s.toolId),['internal_logs.search']);
  assert.equal(playbook.steps[0].purpose,'Internal search');assert.match(playbook.steps[0].finding??'',/latency increased/);
  assert.deepEqual(playbook.avoid.map(x=>[x.toolId,x.ruleId]),[['example_connector.analyze','DATA-18']]);
  assert.equal(playbook.status,'VALID');assert.equal(playbook.sourceRunId,a.id);assert.equal(playbook.index.status,'LOCAL_ONLY');
  assert.equal(h.store.get('run',a.id).metrics.inputTokens,4000);
  await h.ask('Investigate why checkout is failing for customer Globex');assert.equal(h.playbooks().length,1,'an identical procedure is not duplicated');
 }finally{await h.close();}
});

test('a fresh agent retrieves the playbook for a similar task and the comparison is measured from both runs',async()=>{
 const h=await harness();try{
  const a=await h.ask('Investigate why checkout is failing for customer Globex');const [playbook]=h.playbooks();
  const b=await h.ask('Why is checkout failing for customer Initech?');
  assert.notEqual(a.sessionId,b.sessionId);
  const stored=h.store.get('run',b.id);assert.deepEqual(stored.playbookIds,[playbook.id]);assert.equal(stored.context.playbooks[0].id,playbook.id);
  assert.deepEqual(stored.structuredPlan.steps[0].memoryReferences,[playbook.id],'playbook citations are verified against the supplied context');
  assert.equal((await h.call('/playbooks/'+playbook.id+'/comparison',undefined,h.employee)).status,403);
  const comparison=(await h.call('/playbooks/'+playbook.id+'/comparison',undefined,h.admin)).data;
  assert.deepEqual([comparison.before.steps,comparison.before.blocked,comparison.before.inputTokens],[2,1,4000]);
  assert.deepEqual([comparison.after.steps,comparison.after.blocked,comparison.after.inputTokens,comparison.after.usedPlaybook],[1,0,900,true]);
  const state=(await h.call('/state',undefined,h.admin)).data;assert.equal(state.playbooks.length,1);
 }finally{await h.close();}
});

test('playbooks stay inside their tenant and role scope and unrelated tasks do not match',async()=>{
 const h=await harness();try{
  await h.ask('Investigate why checkout is failing for customer Globex');
  assert.equal(candidatePlaybooks(h.service,{tenantId:'other-tenant',role:'employee'}).length,0);
  const candidates=candidatePlaybooks(h.service,{tenantId:'acme-demo',role:'employee'});assert.equal(candidates.length,1);
  assert.equal((await discoverPlaybooks('Summarize the quarterly hiring plan',candidates,'acme-demo')).playbooks.length,0);
 }finally{await h.close();}
});

test('Agent Engine ranks candidates when configured and failures fall back to local ranking',async()=>{
 const h=await harness();try{
  await h.ask('Investigate why checkout is failing for customer Globex');const candidates=candidatePlaybooks(h.service,{tenantId:'acme-demo',role:'employee'});
  const ranked=await discoverPlaybooks('anything',candidates,'acme-demo',{engine:'atlas-agent-engine',save:async()=>{},discover:async()=>[candidates[0].id,'unknown-id']});
  assert.deepEqual([ranked.engine,ranked.degraded,ranked.playbooks.map(p=>p.id)],['atlas-agent-engine',false,[candidates[0].id]]);
  const fallback=await discoverPlaybooks('checkout failing for a customer',candidates,'acme-demo',{engine:'atlas-agent-engine',save:async()=>{},discover:async()=>{throw new Error('preview service unavailable');}});
  assert.deepEqual([fallback.engine,fallback.degraded,fallback.playbooks.length],['precedent-local',true,1]);
 }finally{await h.close();}
});

test('quarantine marks a playbook that depends on the tool for re-validation and stops recommending it',async()=>{
 const h=await harness();try{
  await h.ask('Analyze the synthetic sandbox logs with the connector','sandbox');
  const [playbook]=h.playbooks();assert.deepEqual(playbook.steps.map(s=>s.toolId),['example_connector.analyze']);
  assert.equal((await h.call('/incidents',{toolId:'example_connector.analyze'},h.admin)).status,200);
  const updated=h.store.get('playbook',playbook.id);assert.equal(updated.status,'NEEDS_REVALIDATION');assert.equal(updated.invalidatedByVersion,h.service.policy().version);
  assert.equal(candidatePlaybooks(h.service,{tenantId:'acme-demo',role:'employee'}).length,0);
  assert.ok(h.store.all('event').some((event:any)=>event.type==='playbook.invalidated'));
 }finally{await h.close();}
});

test('a first-day agent is governed without company memory, and its playbook carries the written procedure',async()=>{
 const h=await harness();try{
  const a=await h.ask('Investigate why checkout is failing for customer Globex','investigation','none');
  const stored=h.store.get('run',a.id);assert.equal(stored.memoryMode,'none');assert.equal(stored.context,null);
  assert.ok(!h.store.all('event').some((event:any)=>event.runId===a.id&&event.type==='retrieval.started'),'no company memory is retrieved');
  assert.deepEqual(h.store.all('execution').filter((e:any)=>stored.executionIds.includes(e.id)).map((e:any)=>e.status),['BLOCKED','SUCCEEDED'],'the gate still enforces every call');
  const [playbook]=h.playbooks();assert.deepEqual(playbook.avoid.map(x=>x.ruleId),['DATA-18']);
  const b=await h.ask('Why is checkout failing for customer Initech?');
  const supplied=h.store.get('run',b.id).context.playbooks[0];
  assert.match(supplied.instructions,/Steps, in order:\n1\. internal_logs\.search/);assert.match(supplied.instructions,/Avoid:\n- example_connector\.analyze/);
  const comparison=(await h.call('/playbooks/'+playbook.id+'/comparison',undefined,h.admin)).data;
  assert.deepEqual([comparison.before.memory,comparison.before.findings,comparison.after.findings,comparison.after.blocked],['none',1,1,0]);
 }finally{await h.close();}
});

test('Voyage rerank suggests only relevant playbooks and its failure falls back to local ranking',async()=>{
 const h=await harness();try{
  await h.ask('Investigate why checkout is failing for customer Globex');const candidates=candidatePlaybooks(h.service,{tenantId:'acme-demo',role:'employee'});
  let request:any;const ranker=voyagePlaybookRanker('test-key',(async(_url:any,init:any)=>{request=JSON.parse(init.body);return new Response(JSON.stringify({data:[{index:0,relevance_score:0.82}]}));}) as typeof fetch)!;
  const ranked=await discoverPlaybooks('Why are payments failing for Initech?',candidates,'acme-demo',ranker);
  assert.deepEqual([ranked.engine,ranked.playbooks.map(p=>p.id)],['voyage-rerank',[candidates[0].id]]);assert.match(request.documents[0],/^Procedure: /);
  const weak=voyagePlaybookRanker('test-key',(async()=>new Response(JSON.stringify({data:[{index:0,relevance_score:0.1}]}))) as typeof fetch)!;
  assert.equal((await discoverPlaybooks('Summarize the hiring plan',candidates,'acme-demo',weak)).playbooks.length,0,'low relevance suggests nothing');
  const failing=voyagePlaybookRanker('test-key',(async()=>new Response('{}',{status:500})) as typeof fetch)!;
  const fallback=await discoverPlaybooks('checkout failing for a customer',candidates,'acme-demo',failing);assert.deepEqual([fallback.engine,fallback.degraded,fallback.playbooks.length],['precedent-local',true,1]);
  assert.equal(voyagePlaybookRanker(''),undefined);
 }finally{await h.close();}
});

test('a model-supplied target on a non-warehouse step never fails the run; a malformed warehouse table is blocked',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);
 const plans=[[{toolId:'internal_logs.search',target:'customer-logs',purpose:'Search',policyReferences:[],memoryReferences:[]}],[{toolId:'warehouse.query',target:'not a table!',purpose:'Query',policyReferences:[],memoryReferences:[]}]];
 const fake={health:async()=>({}),create:async()=>{const steps=plans.shift();return {session:{state:{sessionId:'w'}},response:{result:async()=>({data:{goal:'g',reply:'',steps},events:[]})}};}};
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,undefined,fake as any).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;const call=async(path:string,body:unknown,token?:string)=>(await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)})).json() as any;
 try{
  const token=(await call('/login',{role:'employee'})).token;
  const logs=(await call('/comparison',{task:'Investigate checkout errors',scenario:'investigation',planner:'eve',target:'governed'},token)).runs[0];
  assert.equal(logs.status,'FINISHED');assert.equal(store.get('execution',logs.executionIds[0]).status,'SUCCEEDED');assert.equal(store.get('execution',logs.executionIds[0]).action.target,undefined);
  const wh=(await call('/comparison',{task:'Weekly active customers',scenario:'warehouse',planner:'eve',target:'governed'},token)).runs[0];
  assert.equal(wh.status,'FINISHED');assert.equal(store.get('execution',wh.executionIds[0]).decision.ruleId,'DATA-30');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});

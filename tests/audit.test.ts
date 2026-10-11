import {test} from 'node:test';import assert from 'node:assert/strict';
import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';import {createApp} from '../apps/server/api.js';

test('original inspection retains historical policy, context and evaluated grant state after reset',()=>{
 let now=10000;const service=new Precedent(openStore(':memory:'),()=>now);
 try{
  const session=service.session(),action=service.action(session.id,'staging_db.read','staging-records','production');const held=service.execute(action,'held');const grant=service.approve(held.id,30);
  service.store.put('run',{id:'original-run',mode:'governed',sessionId:session.id,task:'Read staging',plan:['staging_db.read'],executionIds:[held.id],context:{scope:{tenantId:'acme-demo',role:'employee'},policy:{version:1},currentRules:[],episodes:[]}});
  const allowed=service.execute(action,held.id+':resume');assert.equal(allowed.status,'SUCCEEDED');
  service.revoke((grant as {id:string}).id);now=50000;service.resetDemo(service.policy().version,service.demo().demoRunId);
  const before=JSON.stringify(service.store.all('event')),receipts=service.store.all('receipt');
  const original=service.inspectOriginal(allowed.id);assert.equal(original.mode,'recorded-evidence');assert.equal(original.execution.decision.verdict,'ALLOW');assert.equal(original.policy.version,1);assert.equal(original.contextAtPlanning.policy.version,1);assert.equal(original.runAssociation,'planned-step');assert.equal(original.receiptConfirmed,true);
  assert.equal(original.grantSnapshotsAtDecision[0].revoked,false);assert.equal(original.grantSnapshotsAtDecision[0].consumed,false);assert.equal(original.currentGrantStates[0].revoked,true);assert.equal(original.currentGrantStates[0].consumed,true);assert.equal(original.sideEffects,0);
  assert.deepEqual(service.store.all('receipt'),receipts);assert.equal(JSON.stringify(service.store.all('event')),before);assert.equal(original.execution.at,10000);
 }finally{service.store.close();}
});
test('missing historical evidence and mismatched receipts remain explicitly unavailable',()=>{
 const store=openStore(':memory:'),service=new Precedent(store);
 try{
  const session=service.session();const execution=service.execute(service.action(session.id,'internal_logs.search','customer-logs','production'),'inspect-no-policy');
  const receipt=store.get('receipt',execution.receiptId!)!;store.put('receipt',{...receipt,toolVersion:'wrong-version'});
  const get=store.get;store.get=((kind:string,id:string)=>kind==='policy_version'?undefined:get(kind,id)) as typeof store.get;
  const original=service.inspectOriginal(execution.id);assert.equal(original.policy,null);assert.equal(original.availability.historicalPolicy,false);assert.equal(original.contextAtPlanning,null);assert.equal(original.runAssociation,'unavailable');assert.equal(original.receiptConfirmed,false);
  assert.throws(()=>service.inspectOriginal('missing'),/Unknown execution/);
 }finally{store.close();}
});
test('original evidence API checks tenant, owner and historical administrator context',async()=>{
 const service=new Precedent(openStore(':memory:'));let principal={userId:'owner',role:'admin' as 'admin'|'employee',tenantId:'acme-demo'};
 const session=service.session({tenantId:'acme-demo',role:'admin'},'owner');const execution=service.execute(service.action(session.id,'internal_logs.search','customer-logs','production'),'private-context');
 service.store.put('run',{id:'private-run',sessionId:session.id,context:{scope:{tenantId:'acme-demo',role:'admin'},episodes:[{summary:'administrator-only history'}]}});
 const server=createApp(service,undefined,{async resolve(){return principal;}}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;const url=base+`/executions/${execution.id}/original`;
 service.emit('context.retrieved',{sessionId:session.id,context:{scope:{tenantId:'acme-demo',role:'admin'},episodes:[{summary:'administrator-only history'}]}});
 service.store.put('episode',{id:'private-episode',tenantId:'acme-demo',visibleRoles:['admin'],summary:'administrator-only history'});
 try{
  assert.equal((await fetch(url)).status,200);
  principal={...principal,role:'employee'};assert.equal((await fetch(url)).status,403);
  const state=await(await fetch(base+'/state')).json();assert.ok(!JSON.stringify(state.events).includes('administrator-only history'));assert.ok(!JSON.stringify(state.episodes).includes('administrator-only history'));
  const stream=await fetch(base+'/events',{headers:{'Last-Event-ID':'1'}});const reader=stream.body!.getReader();const chunk=new TextDecoder().decode((await reader.read()).value);assert.ok(chunk.includes('id: 2'));assert.ok(!chunk.includes('administrator-only history'));await reader.cancel();
  principal={...principal,userId:'other'};assert.equal((await fetch(url)).status,403);
  principal={...principal,role:'admin',tenantId:'foreign'};assert.equal((await fetch(url)).status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

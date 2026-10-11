import {test} from 'node:test';import assert from 'node:assert/strict';
import {openStore} from '../apps/server/store.js';import {Precedent} from '../apps/server/service.js';
import {ExecutionGateway} from '../packages/execution/index.js';import {connectConnector} from '../packages/demo-tools/client.js';
import {retrieveForRuntime} from '../apps/server/context.js';import {LocalRuntime,MongoRuntime,type DomainRuntime} from '../apps/server/runtime.js';
import {createApp} from '../apps/server/api.js';import {execFile} from 'node:child_process';import {promisify} from 'node:util';

async function verifyReset(runtime:DomainRuntime){
 const connector=await connectConnector(':memory:');const gateway=new ExecutionGateway(runtime,connector);
 try{
  const session=await runtime.run(s=>s.session()),oldDemo=await runtime.run(s=>s.demo().demoRunId);
  const action=await runtime.run(s=>s.action(session.id,'example_connector.analyze','sandbox-logs','sandbox'));
  await gateway.control(s=>s.publish({...s.policy(),sandboxAllowed:true}));
  const succeeded=await gateway.execute(action,crypto.randomUUID());assert.equal(succeeded.status,'SUCCEEDED');assert.equal(succeeded.demoRunId,oldDemo);
  const staging=await runtime.run(s=>s.action(session.id,'staging_db.read','staging-records','production'));
  const held=await gateway.execute(staging,crypto.randomUUID());await gateway.control(s=>s.approve(held.id,30));
  const grant=await runtime.run(s=>s.store.all('grant').find(g=>g.action.sessionId===session.id));
  await gateway.control(s=>s.incident('example_connector.analyze'));
  const before=await runtime.run(s=>({policy:s.policy(),execution:s.store.get('execution',succeeded.id),receipt:s.store.get('receipt',succeeded.receiptId!),grant:s.store.get('grant',grant.id),version:s.store.get('policy_version',String(succeeded.decision.policyVersion))}));
  const reset=await gateway.control(s=>s.resetDemo(s.policy().version,oldDemo));assert.notEqual(reset.demoRunId,oldDemo);
  const state=await runtime.run(s=>s.snapshot());assert.equal(state.executions.length,0);assert.equal(state.approvals.length,0);assert.equal(state.grants.length,0);assert.equal(state.episodes.length,0);assert.equal(state.graph.edges.length,0);
  assert.equal(state.policy.sandboxAllowed,true);assert.deepEqual(state.policy.quarantined,[]);assert.ok(state.archivedDemos.some(d=>d.demoRunId===oldDemo));assert.ok(state.auditExecutions.some(e=>e.id===succeeded.id));
  await assert.rejects(gateway.execute(action,crypto.randomUUID()),/archived demo/);assert.equal((await connector.receipts()).length,1);
  await assert.rejects(runtime.run(s=>s.workerHeartbeat(session.id)),/archived demo/);
  const after=await runtime.run(s=>({execution:s.store.get('execution',succeeded.id),receipt:s.store.get('receipt',succeeded.receiptId!),grant:s.store.get('grant',grant.id),version:s.store.get('policy_version',String(succeeded.decision.policyVersion))}));
  assert.deepEqual(after,{execution:before.execution,receipt:before.receipt,grant:before.grant,version:before.version});
  assert.equal((await runtime.run(s=>s.replay(succeeded.id,succeeded.decision.policyVersion))).sideEffects,0);
  const fresh=await runtime.run(s=>s.session());const context=await retrieveForRuntime(runtime,fresh.id,'sandbox-logs','sandbox',{key:''});assert.equal(context.episodes.length,0);
  assert.equal((await gateway.execute(await runtime.run(s=>s.action(fresh.id,'example_connector.analyze','sandbox-logs','sandbox')),crypto.randomUUID())).status,'SUCCEEDED');
 }finally{await connector.close();}
}
test('reset preserves audit and receipts while isolating new demo sessions and memory',async()=>{
 const runtime=new LocalRuntime(new Precedent(openStore(':memory:')));try{await verifyReset(runtime);}finally{await runtime.close();}
});
test('MongoDB reset commits a fresh namespace without deleting history',{skip:!process.env.TEST_MONGODB_URI,timeout:20000},async()=>{
 const uri=new URL(process.env.TEST_MONGODB_URI!);uri.pathname+='_reset';const runtime=await MongoRuntime.connect(uri.toString());
 try{await verifyReset(runtime);}finally{await runtime.close();}
});
test('stale reset and an unfinished dispatch cannot modify the namespace',()=>{
 const service=new Precedent(openStore(':memory:'));try{const session=service.session(),demo=service.demo(),policy=service.policy();
 assert.throws(()=>service.resetDemo(policy.version+1,demo.demoRunId),/changed/);
 service.store.put('execution',{id:'inflight',status:'DISPATCHING'});assert.throws(()=>service.resetDemo(policy.version,demo.demoRunId),/dispatching/);assert.deepEqual(service.demo(),demo);
 }finally{service.store.close();}
});
test('reset command uses loopback administrator API and preserves historical receipts',async()=>{
 const service=new Precedent(openStore(':memory:'));const session=service.session();service.execute(service.action(session.id,'internal_logs.search','customer-logs','production'),'cli-history');
 const server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{
  const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','scripts/reset-demo.ts'],{env:{...process.env,PRECEDENT_API_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`},timeout:15000});
  const result=JSON.parse(stdout);assert.equal(result.auditHistory,'preserved');assert.equal(result.demoRunId,service.demo().demoRunId);assert.equal(service.store.all('receipt').length,1);assert.equal(service.snapshot().executions.length,0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

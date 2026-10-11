import {test} from 'node:test';import assert from 'node:assert/strict';
import {warehouseDocuments} from '../packages/warehouse/index.js';
import {MongoRuntime} from '../apps/server/runtime.js';import {ExecutionGateway} from '../packages/execution/index.js';import {connectConnector} from '../packages/demo-tools/client.js';
import {MongoClient} from 'mongodb';
test('MongoDB transactional gate, policy history and restart memory',{skip:!process.env.TEST_MONGODB_URI},async()=>{
 const uri=process.env.TEST_MONGODB_URI!;let runtime=await MongoRuntime.connect(uri);const connector=await connectConnector(':memory:');
 try{let gateway=new ExecutionGateway(runtime,connector);await gateway.recover();const s=await runtime.run(s=>s.session());const a=await runtime.run(service=>service.action(s.id,'internal_logs.search','customer-logs','production'));const id=crypto.randomUUID();assert.equal((await gateway.execute(a,id)).status,'SUCCEEDED');await gateway.execute(a,id);assert.equal((await runtime.run(s=>s.store.all('receipt'))).filter(r=>r.executionId===id).length,1);
 await runtime.close();runtime=await MongoRuntime.connect(uri);gateway=new ExecutionGateway(runtime,connector);const fresh=await runtime.run(s=>s.session());assert.ok((await runtime.run(s=>s.memory(fresh.id,'customer-logs'))).some(e=>e.evidenceId===id));
 const blocked=await runtime.run(service=>service.action(fresh.id,'example_connector.analyze','customer-logs','production'));assert.equal((await gateway.execute(blocked,crypto.randomUUID())).status,'BLOCKED');assert.equal((await connector.receipts()).length,0);
 }finally{await connector.close();await runtime.close();}
});
test('MongoDB stores indexed scope and summary beside authoritative episode records',{skip:!process.env.TEST_MONGODB_URI},async()=>{
 const uri=process.env.TEST_MONGODB_URI!;const runtime=await MongoRuntime.connect(uri);const client=new MongoClient(uri);
 try{const s=await runtime.run(service=>service.session());const action=await runtime.run(service=>service.action(s.id,'internal_logs.search','customer-logs','production'));const id=crypto.randomUUID();await runtime.run(service=>service.execute(action,id));
 const episode=await runtime.run(service=>service.store.all('episode').find(e=>e.evidenceId===id));await client.connect();const row=await client.db().collection('episodes').findOne({id:episode.id});assert.ok(row);assert.equal(row.tenantId,'acme-demo');assert.deepEqual(row.visibleRoles,['employee','admin']);assert.equal(row.summary,episode.summary);assert.equal(JSON.parse(row.body).evidenceId,id);
 const runId=crypto.randomUUID();const memoryId=await runtime.run(service=>{service.store.put('run',{id:runId,mode:'governed',sessionId:s.id,task:'Inspect checkout latency',executionIds:[id]});return service.saveRunOutcome(runId);});const consolidated=await client.db().collection('episodes').findOne({id:memoryId});assert.ok(consolidated);const memory=JSON.parse(consolidated.body);assert.equal(memory.kind,'run-outcome');assert.equal(memory.sourceRunId,runId);assert.equal(memory.outcomes[0].executionId,id);assert.equal(memory.outcomes[0].status,'SUCCEEDED');assert.equal(consolidated.summary,memory.summary);
 const policy=await runtime.run(service=>service.publish({...service.policy(),sandboxAllowed:false}));const rule=await client.db().collection('policy_rules').findOne({policyVersion:policy.version,ruleId:'SANDBOX-04'});assert.ok(rule);assert.equal(rule.tenantId,'acme-demo');assert.deepEqual(rule.visibleRoles,['employee','admin']);assert.equal(rule.summary,JSON.parse(rule.body).summary);assert.equal(JSON.parse(rule.body).policyVersion,policy.version);
 const events=await runtime.run(service=>service.store.all('event'));
 assert.deepEqual(await runtime.readEvents(1),events.slice(1,201));
 assert.deepEqual(await runtime.readEvents(events.length),[]);
 }finally{await client.close();await runtime.close();}
});
test('MongoDB policy stream observes another runtime and resumes across downtime',{skip:!process.env.TEST_MONGODB_URI},async()=>{
 const uri=process.env.TEST_MONGODB_URI!;let observer=await MongoRuntime.connect(uri);const publisher=await MongoRuntime.connect(uri);
 const waitFor=async(version:number)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(observer.notifications?.observedVersion===version)return;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('Change Stream did not observe policy publication');};
 try{
  await observer.startNotifications();
  const policy=await publisher.run(s=>s.publish({...s.policy(),sandboxAllowed:false}));await waitFor(policy.version);
  const saved=await observer.run(s=>s.store.get('metadata','policy-watch'));assert.ok(saved.resumeToken);
  assert.ok((await observer.run(s=>s.store.all('event'))).some(e=>e.type==='policy.observed'&&e.version===policy.version));
  await observer.close();
  const next=await publisher.run(s=>s.publish({...s.policy(),sandboxAllowed:true}));
  observer=await MongoRuntime.connect(uri);await observer.startNotifications();await waitFor(next.version);assert.equal(observer.notifications?.resumed,true);
  assert.ok((await observer.run(s=>s.store.all('event'))).some(e=>e.type==='policy.observed'&&e.version===next.version));
  const session=await observer.run(s=>s.session());const action=await observer.run(s=>s.action(session.id,'example_connector.analyze','sandbox-logs','sandbox'));
  assert.equal((await observer.run(s=>s.execute(action,crypto.randomUUID()))).decision.policyVersion,next.version);
  const incident=await publisher.run(s=>s.incident('example_connector.analyze'));
  const denied=await observer.run(s=>s.execute(action,crypto.randomUUID()));assert.equal(denied.status,'BLOCKED');assert.equal(denied.decision.policyVersion,incident.version);
  await waitFor(incident.version);
 }finally{await observer.close();await publisher.close();}
});
test('MongoDB read-only view sees committed data, never writes, and does not wait behind the write queue',{skip:!process.env.TEST_MONGODB_URI},async()=>{
 const uri=process.env.TEST_MONGODB_URI!.replace(/\/([^/?]+)(\?|$)/,(_m,db,q)=>`/${db}_read${q}`);const runtime=await MongoRuntime.connect(uri);
 try{
  const session=await runtime.run(s=>s.session());
  assert.equal(await runtime.read!(s=>s.store.get('session',session.id)?.id),session.id,'committed writes are visible');
  await assert.rejects(runtime.read!(s=>{s.record('metadata',{id:'read-probe'});return 1;}),/read-only/);
  assert.equal(await runtime.read!(s=>s.store.get('metadata','read-probe')),undefined,'nothing was persisted');
  // A slow write must not block a read.
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const slowWrite=runtime.run(async s=>{await gate;s.record('metadata',{id:'after-read'});});
  const version=await Promise.race([runtime.read!(s=>s.policy().version),new Promise<'blocked'>(resolve=>setTimeout(()=>resolve('blocked'),8000))]);
  assert.notEqual(version,'blocked');release();await slowWrite;
 }finally{await runtime.close();}
});
test('MongoDB holds the synthetic warehouse: seeded once, and warehouse.query reads its rows from the database',{skip:!process.env.TEST_MONGODB_URI},async()=>{
 const runtime=await MongoRuntime.connect(process.env.TEST_MONGODB_URI!);const connector=await connectConnector(':memory:');
 try{
  assert.equal(await runtime.seedWarehouse(warehouseDocuments()),true);assert.equal(await runtime.seedWarehouse(warehouseDocuments()),false);
  assert.equal((await runtime.warehouseRows('acme_dw.t_04417')).length,12);assert.equal((await runtime.warehouseRows('acme_dw.weekly_active_customers')).length,0);
  const gateway=new ExecutionGateway(runtime,connector,runtime.warehouseRows);const s=await runtime.run(service=>service.session());
  const action=await runtime.run(service=>service.action(s.id,'warehouse.query','warehouse','production','acme_dw.t_04417'));
  const done=await gateway.execute(action,crypto.randomUUID());assert.equal(done.status,'SUCCEEDED');
  const receipt=await runtime.run(service=>service.store.get('receipt',done.receiptId));assert.match(receipt.result,/^12 rows from acme_dw\.t_04417 \(read from MongoDB Atlas\)\. Latest week 2026-W39: NA 4621, EMEA 3531, APAC 3074/);
 }finally{await connector.close();await runtime.close();}
});

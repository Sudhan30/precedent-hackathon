import {test} from 'node:test';import assert from 'node:assert/strict';
import {openStore} from '../apps/server/store.js';import {Precedent} from '../apps/server/service.js';import {ExecutionGateway} from '../packages/execution/index.js';import {connectConnector} from '../packages/demo-tools/client.js';
test('real MCP gate blocks before downstream and executes once with committed intent',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const connector=await connectConnector(':memory:');const gateway=new ExecutionGateway(service,connector);
 try{const s=service.session();const blocked=service.action(s.id,'example_connector.analyze','customer-logs','production');assert.equal((await gateway.execute(blocked,'blocked')).status,'BLOCKED');assert.equal((await connector.receipts()).length,0);
 const allowed=service.action(s.id,'example_connector.analyze','sandbox-logs','sandbox');const result=await gateway.execute(allowed,'allowed');assert.equal(result.status,'SUCCEEDED');assert.equal((await connector.receipts()).length,1);assert.ok(store.all('receipt')[0].downstreamReceiptId);
 await gateway.execute(allowed,'allowed');assert.equal((await connector.receipts()).length,1);
 service.incident('example_connector.analyze');assert.equal((await gateway.execute(allowed,'quarantined')).status,'BLOCKED');assert.equal((await connector.receipts()).length,1);
 const events=store.all('event');assert.ok(events.findIndex(e=>e.type==='execution.intent')<events.findIndex(e=>e.type==='execution.started'));
 }finally{await connector.close();store.close();}
});
test('ambiguous dispatch and crash recovery never retry side effects',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);let calls=0;const gateway=new ExecutionGateway(service,{async execute(){calls++;assert.equal(store.get('execution','ambiguous').status,'DISPATCHING');throw new Error('timeout');},async receipts(){return [];}});
 const s=service.session();const a=service.action(s.id,'example_connector.analyze','sandbox-logs','sandbox');assert.equal((await gateway.execute(a,'ambiguous')).status,'UNKNOWN');await gateway.execute(a,'ambiguous');assert.equal(calls,1);
 store.put('execution',{id:'crashed',action:a,baseline:false,status:'DISPATCHING'});const recovered=new ExecutionGateway(service,{async execute(){throw new Error('must not dispatch');},async receipts(){return [];}});await recovered.recover();assert.equal(store.get('execution','crashed').status,'UNKNOWN');store.close();
});
test('expired and quarantine-overridden grants never dispatch or create receipts',async()=>{
 const store=openStore(':memory:');let now=1000;const service=new Precedent(store,()=>now);let calls=0;const gateway=new ExecutionGateway(service,{async execute(){calls++;return {result:'fixture'};},async receipts(){return [];}});const s=service.session();const staging=service.action(s.id,'staging_db.read','staging-records','production');
 await gateway.execute(staging,'held');service.approve('held',30);now=31000;assert.equal((await gateway.execute(staging,'expired')).status,'PENDING');assert.equal(store.all('receipt').length,0);assert.equal(calls,0);
 service.approve('expired',30);service.incident('staging_db.read');assert.equal((await gateway.execute(staging,'quarantine')).status,'BLOCKED');assert.equal(store.all('receipt').length,0);store.close();
});
test('internal tools compute observed findings from controlled fixtures',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const gateway=new ExecutionGateway(service,{async execute(){throw new Error('No external call expected');},async receipts(){return [];}});const s=service.session();const a=service.action(s.id,'internal_logs.search','customer-logs','production');const result=await gateway.execute(a,'derived');assert.match(store.get('receipt',result.receiptId!).result,/120ms to 900ms/);store.close();
});

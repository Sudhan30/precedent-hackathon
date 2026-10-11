import {registry} from '../packages/contracts/index.js';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {openStore} from '../apps/server/store.js';import {Precedent} from '../apps/server/service.js';
test('incident graph separates capabilities, receipts, blocked attempts and active exceptions',()=>{
 let now=100000;const store=openStore(':memory:');const service=new Precedent(store,()=>now);const baseline=service.session(),governed=service.session();
 assert.equal(service.graph().exposure.governedSessions.length,0);assert.equal(service.graph().edges.filter(e=>e.kind==='configured').length,2*Object.keys(registry).length);assert.ok(service.graph().sessions.every(s=>s.status==='offline'&&s.acknowledgedVersion===null));
 const restricted=service.action(governed.id,'example_connector.analyze','customer-logs','production');service.execute(restricted,'blocked');
 service.execute(service.action(baseline.id,'example_connector.analyze','customer-logs','production'),'baseline',true);
 assert.deepEqual(service.graph('example_connector.analyze').exposure.governedSessions,[]);assert.equal(service.graph().exposure.blockedAttempts,1);
 service.execute(service.action(governed.id,'example_connector.analyze','sandbox-logs','sandbox'),'allowed');
 const staging=service.action(governed.id,'staging_db.read','staging-records','sandbox');service.execute(staging,'held');const grant=service.approve('held',30);assert.ok('id' in grant);
 assert.equal(service.graph().edges.filter(e=>e.kind==='exception').length,1);now+=30000;assert.equal(service.graph().edges.filter(e=>e.kind==='exception').length,0);assert.ok(store.get('grant',grant.id));
 const incident=service.incident('example_connector.analyze');assert.deepEqual(incident.executedSessions,[governed.id]);assert.equal(incident.baselineReceipts,1);assert.equal(incident.blockedAttempts,1);assert.ok(incident.evidenceIds.includes('allowed'));assert.equal(service.execute(restricted,'quarantined').status,'BLOCKED');assert.equal(store.all('usage_edge').length,5);store.close();
});
test('worker observations refresh active adapters, leave offline and seeded acknowledgments unchanged',()=>{
 let now=100000;const store=openStore(':memory:');const service=new Precedent(store,()=>now);const active=service.session(),offline=service.session(),seeded=service.session();store.put('session',{...seeded,seeded:true,acknowledgedVersion:null});
 service.workerHeartbeat(active.id);service.workerHeartbeat(offline.id);now+=30000;service.workerHeartbeat(active.id);
 const published=service.publish({...service.policy(),sandboxAllowed:false});assert.equal(store.get('session',active.id).acknowledgedVersion,published.version);assert.equal(store.get('session',offline.id).acknowledgedVersion,1);assert.equal(store.get('session',seeded.id).acknowledgedVersion,null);assert.throws(()=>service.workerHeartbeat(seeded.id));
 const graph=service.graph();assert.equal(graph.sessions.find(s=>s.id===active.id)?.status,'connected');assert.equal(graph.sessions.find(s=>s.id===offline.id)?.status,'offline');assert.equal(graph.sessions.find(s=>s.id===seeded.id)?.status,'offline');store.close();
});
test('unconfirmed success and version-mismatched receipts cannot count as known exposure',()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const session=service.session();const action=service.action(session.id,'example_connector.analyze','sandbox-logs','sandbox');const execution=service.execute(action,'evidence');
 const receipt=store.get('receipt',execution.receiptId!);store.put('receipt',{...receipt,toolVersion:'other-version'});assert.equal(service.graph().exposure.governedSessions.length,0);assert.equal(service.graph().exposure.unknownOutcomes,1);
 store.put('receipt',receipt);assert.equal(service.graph('example_connector.analyze','other-version').exposure.governedSessions.length,0);assert.equal(service.graph('example_connector.analyze','2.4').exposure.governedSessions.length,1);store.close();
});

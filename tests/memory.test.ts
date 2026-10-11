import {test} from 'node:test';import assert from 'node:assert/strict';
import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';
import {ExecutionGateway} from '../packages/execution/index.js';import {connectConnector} from '../packages/demo-tools/client.js';
import {retrieveContext} from '../packages/retrieval/index.js';
test('run memory consolidates blocked action and confirmed alternative with actual evidence',async()=>{
 const service=new Precedent(openStore(':memory:')),connector=await connectConnector(':memory:'),gateway=new ExecutionGateway(service,connector);
 try{
  const session=service.session();
  const blocked=await gateway.execute(service.action(session.id,'example_connector.analyze','customer-logs','production'),'memory-blocked');
  const allowed=await gateway.execute(service.action(session.id,'internal_logs.search','customer-logs','production'),'memory-allowed');
  service.store.put('run',{id:'investigation',mode:'governed',sessionId:session.id,task:'Find checkout latency',executionIds:[blocked.id,allowed.id]});
  const id=service.saveRunOutcome('investigation')!;const episode=service.store.get('episode',id)!;
  assert.equal(episode.alternativeCompleted,true);assert.equal(episode.alternative,'internal_logs.search');assert.equal(episode.outcomeStatus,'FINISHED');assert.equal(episode.taskSummary,'Find checkout latency');
  assert.deepEqual(episode.evidenceIds,[blocked.id,allowed.id]);assert.ok(episode.supportingEventIds.length>0);assert.ok(episode.supportingEventIds.every((id:string)=>service.store.get('event',id)));
  assert.equal(episode.outcomes[0].receiptId,null);assert.equal(episode.outcomes[1].receiptId,allowed.receiptId);assert.match(episode.summary,/900ms/);assert.match(episode.summary,/Permitted alternative completed/);
  assert.equal(service.saveRunOutcome('investigation'),id);assert.equal(service.store.all('episode').filter(e=>e.kind==='run-outcome').length,1);
  const fresh=service.session();const context=await retrieveContext(service,fresh.id,'customer-logs','checkout',{key:''});assert.ok(context.episodes.some(e=>e.sourceRunId==='investigation'&&e.alternativeCompleted));
  service.store.put('run',{id:'baseline-run',mode:'baseline',sessionId:session.id,task:'Bypass',executionIds:[allowed.id]});assert.equal(service.saveRunOutcome('baseline-run'),null);
 }finally{await connector.close();service.store.close();}
});
test('resumed approval supersedes waiting memory without reusing permission',async()=>{
 const service=new Precedent(openStore(':memory:'));try{
  const session=service.session(),action=service.action(session.id,'staging_db.read','staging-records','production');const held=service.execute(action,'held-step');
  service.store.put('run',{id:'staging-run',mode:'governed',sessionId:session.id,task:'Read staging',executionIds:[held.id]});
  const waiting=service.saveRunOutcome('staging-run')!;assert.equal(service.store.get('episode',waiting).outcomeStatus,'WAITING');
  service.approve(held.id,30);service.execute(action,held.id+':resume');const completed=service.saveRunOutcome('staging-run')!;
  assert.notEqual(completed,waiting);assert.equal(service.store.get('episode',waiting).supersededBy,completed);assert.equal(service.store.get('episode',completed).outcomeStatus,'FINISHED');
  const fresh=service.session();const context=await retrieveContext(service,fresh.id,'staging-records','staging',{key:''});assert.ok(!context.episodes.some(e=>e.id===waiting));assert.ok(context.episodes.some(e=>e.id===completed));
  assert.equal(service.execute(service.action(fresh.id,'staging_db.read','staging-records','production'),'new-staging').status,'PENDING');
 }finally{service.store.close();}
});
test('mismatched or missing receipts never become successful memory outcomes',()=>{
 const service=new Precedent(openStore(':memory:'));try{
  const session=service.session(),action=service.action(session.id,'internal_logs.search','customer-logs','production');const execution=service.execute(action,'bad-receipt');
  const receipt=service.store.get('receipt',execution.receiptId!)!;service.store.put('receipt',{...receipt,toolVersion:'other-version'});
  service.store.put('run',{id:'unknown-run',mode:'governed',sessionId:session.id,task:'Inspect logs',executionIds:[execution.id]});
  const episode=service.store.get('episode',service.saveRunOutcome('unknown-run')!)!;assert.equal(episode.outcomeStatus,'UNKNOWN');assert.equal(episode.outcomes[0].status,'UNKNOWN');assert.equal(episode.outcomes[0].result,null);assert.equal(episode.outcomes[0].receiptId,null);assert.equal(episode.alternativeCompleted,false);
 }finally{service.store.close();}
});

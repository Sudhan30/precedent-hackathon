import {test} from 'node:test';import assert from 'node:assert/strict';
import {actionInputSchema,policyDecisionSchema,policyProposalSchema,snapshotRecordsSchema,runEventSchema} from '../packages/contracts/index.js';
import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';import {createApp} from '../apps/server/api.js';

test('new domain records reject malformed grants and roll back partial policy publication',()=>{
 const service=new Precedent(openStore(':memory:'),()=>10000);
 try{const session=service.session(),action=service.action(session.id,'staging_db.read','staging-records','production');service.execute(action,'held');const before=JSON.stringify(service.snapshot());
  assert.throws(()=>service.record('grant',{id:'bad',action,policyVersion:service.policy().version,toolVersion:'1.0',expiresAt:Infinity,consumed:false,revoked:false}));assert.equal(service.store.get('grant','bad'),undefined);
  assert.throws(()=>service.store.atomic(()=>{service.publish({...service.policy(),sandboxAllowed:false},true);service.record('event',{id:'bad-event',type:'policy.published',at:NaN});}));assert.equal(JSON.stringify(service.snapshot()),before);
  assert.throws(()=>service.record('proposal',{id:'duplicate-evidence',status:'DRAFT',baseVersion:1,scope:{actorId:'engineer-1',toolId:'demo_export.send',toolVersion:'2.4',resourceId:'sandbox-logs',environment:'sandbox'},evidenceIds:['same','same'],count:2,description:'Invalid evidence',at:service.clock()}));
 }finally{service.store.close();}
});
test('contracts preserve provenance and legacy audit fields while rejecting unsafe input and allow decisions',()=>{
 const input={sessionId:'8d6fe67f-7158-4508-8dcb-ecf3c8e5c9d2',toolId:'internal_logs.search',resourceId:'customer-logs',environment:'production',executionId:'call'};
 assert.equal(actionInputSchema.safeParse(input).success,true);for(const extra of [{actorId:'admin'},{baseline:true},{resourceClassification:'synthetic'},{toolVersion:'safe'}])assert.equal(actionInputSchema.safeParse({...input,...extra}).success,false);
 assert.equal(policyDecisionSchema.safeParse({verdict:'ALLOW',policyVersion:0,reason:'unverified',ruleId:'POLICY-01'}).success,false);assert.equal(policyDecisionSchema.safeParse({verdict:'BLOCK',policyVersion:0,reason:'unverified',ruleId:'POLICY-01'}).success,true);
 const event=runEventSchema.parse({id:'old-event',type:'execution.blocked',at:1,recordedEvaluator:'legacy-v1'});assert.equal(event.recordedEvaluator,'legacy-v1');assert.equal(event.runId,undefined);
 assert.equal(policyProposalSchema.safeParse({id:'missing-version',status:'PUBLISHED',baseVersion:1,scope:{actorId:'engineer-1',toolId:'demo_export.send',toolVersion:'2.4',resourceId:'sandbox-logs',environment:'sandbox'},evidenceIds:['a','b'],count:2,description:'Evidence-backed scope',at:1}).success,false);
});
test('HTTP state uses shared contracts and refuses malformed stored records without rewriting history',async()=>{
 const service=new Precedent(openStore(':memory:')),session=service.session();service.execute(service.action(session.id,'internal_logs.search','customer-logs','production'),'allowed');service.incident('example_connector.analyze');
 const server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();const headers={Authorization:'Bearer '+token};const response=await fetch(base+'/state',{headers});assert.equal(response.status,200);const state=snapshotRecordsSchema.parse(await response.json());assert.equal(state.episodes[0].evidenceId,'allowed');assert.equal(state.incidents[0].toolVersion,'2.4');assert.ok(state.policies[0].rules);
  const legacy={id:'legacy-grant',action:service.action(session.id,'staging_db.read','staging-records','production'),policyVersion:service.policy().version,expiresAt:Date.now()+30000,consumed:false};service.store.put('grant',legacy);const legacyResponse=await fetch(base+'/state',{headers});assert.equal(legacyResponse.status,200);const legacyState=snapshotRecordsSchema.parse(await legacyResponse.json());assert.equal(legacyState.grants[0].toolVersion,undefined);assert.equal(legacyState.grants[0].revoked,undefined);assert.deepEqual(service.store.get('grant',legacy.id),legacy);assert.equal(service.execute(legacy.action,'unverifiable-legacy').status,'PENDING');
  const invalid={id:'corrupt-legacy-grant',action:service.action(session.id,'staging_db.read','staging-records','production'),policyVersion:service.policy().version,toolVersion:'1.0',expiresAt:String(Date.now()+30000),consumed:false,revoked:false};service.store.put('grant',invalid);const beforeReceipts=service.store.all('receipt').length;assert.equal(service.execute(invalid.action,'invalid-expiry').status,'PENDING');assert.equal(service.store.all('receipt').length,beforeReceipts);
  const result=await fetch(base+'/state',{headers});assert.equal(result.status,400);assert.deepEqual(service.store.get('grant',invalid.id),invalid);assert.notEqual(service.replay('allowed',1).decision.verdict,'REQUIRE_APPROVAL');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

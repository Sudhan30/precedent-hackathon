import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../apps/server/store.js';
import {Precedent} from '../apps/server/service.js';
import {evaluate} from '../packages/policy-engine/index.js';
import type {Action,Grant} from '../packages/contracts/index.js';
const base:Action={actorId:'engineer-1',agentId:'a',sessionId:'s',toolId:'staging_db.read',resourceId:'staging-records',environment:'sandbox'};
const policy={version:1,sandboxAllowed:true,quarantined:[]};
for(const field of ['actorId','agentId','sessionId','toolId','resourceId','environment'] as const){
 test(`grant cannot cross ${field}`,()=>{
 const grant:Grant={id:'g',action:base,policyVersion:1,toolVersion:'1.0',revoked:false,expiresAt:100,consumed:false};
 const changed={...base,[field]:field==='environment'?'production':'other'} as Action;
 assert.notEqual(evaluate(changed,policy,[grant],50).verdict,'ALLOW');
 });
}
test('expiry, stale version, consumption and quarantine override approvals',()=>{
 const g:Grant={id:'g',action:base,policyVersion:1,toolVersion:'1.0',revoked:false,expiresAt:100,consumed:false};
 assert.equal(evaluate(base,policy,[g],99).verdict,'ALLOW');
 assert.notEqual(evaluate(base,policy,[g],100).verdict,'ALLOW');
 assert.notEqual(evaluate(base,{...policy,version:2},[g],50).verdict,'ALLOW');
 assert.notEqual(evaluate(base,policy,[{...g,consumed:true}],50).verdict,'ALLOW');
 assert.notEqual(evaluate(base,policy,[{...g,revoked:true}],50).verdict,'ALLOW');
 assert.notEqual(evaluate(base,policy,[{...g,toolVersion:'2.0'}],50).verdict,'ALLOW');
 assert.equal(evaluate(base,{...policy,quarantined:['staging_db.read@1.0']},[g],50).verdict,'BLOCK');
});
test('execution gate, idempotency, approval, replay and restart memory',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'precedent-')),'test.db');let store=openStore(path);let now=1000;let service=new Precedent(store,()=>now);
 const s=service.session();const denied=service.action(s.id,'example_connector.analyze','customer-logs','production');
 assert.equal(service.execute(denied,'denied').status,'BLOCKED');assert.equal(store.all('receipt').length,0);
 const allowed=service.action(s.id,'internal_logs.search','customer-logs','production');
 assert.equal(service.execute(allowed,'allowed').status,'SUCCEEDED');service.execute(allowed,'allowed');assert.equal(store.all('receipt').length,1);
 assert.throws(()=>service.execute(denied,'allowed'));
 const staging=service.action(s.id,'staging_db.read','staging-records','sandbox');service.execute(staging,'held');
 for(const ttl of [NaN,Infinity,0,-1,301])assert.throws(()=>service.approve('held',ttl));
 service.approve('held',30);assert.equal(service.execute(staging,'resumed').status,'SUCCEEDED');
 assert.equal(service.replay('resumed',1).decision.verdict,'ALLOW');assert.equal(store.all('receipt').length,2);
 assert.equal(service.execute(staging,'consumed').status,'PENDING');service.approve('consumed',30);now+=30000;
 assert.equal(service.execute(staging,'expired').status,'PENDING');assert.equal(store.all('receipt').length,2);
 store.close();store=openStore(path);service=new Precedent(store,()=>now);const fresh=service.session();
 assert.ok(service.memory(fresh.id,'customer-logs').some(e=>e.evidenceId==='allowed'));
 service.incident('internal_logs.search');assert.equal(service.execute(allowed,'quarantined').status,'BLOCKED');assert.equal(store.all('receipt').length,2);store.close();
});
test('unverifiable policies and inherited registry keys fail closed',()=>{
 for(const policy of [{version:0,sandboxAllowed:true,quarantined:[]},{version:NaN,sandboxAllowed:true,quarantined:[]},{version:1,sandboxAllowed:true,quarantined:null}])assert.equal(evaluate(base,policy as any).verdict,'BLOCK');
 assert.equal(evaluate({...base,toolId:'constructor' as any},policy).verdict,'BLOCK');
});
test('missing policy and malformed grant records cannot authorize',()=>{
 assert.equal(evaluate(base,undefined as any).verdict,'BLOCK');
 assert.equal(evaluate(base,policy,[null as any]).verdict,'REQUIRE_APPROVAL');
});

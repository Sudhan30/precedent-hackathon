import {test} from 'node:test';import assert from 'node:assert/strict';
import {previewPolicyChange} from '../packages/policies/index.js';import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';import {createApp} from '../apps/server/api.js';
test('policy preview is read-only and preserves quarantine and reviewed allowances',()=>{
 const service=new Precedent(openStore(':memory:'));
 try{
  service.publish({...service.policy(),quarantined:['example_connector.analyze@2.4'],sandboxAllowances:[{actorId:'engineer-1',toolId:'demo_export.send',toolVersion:'2.4',resourceId:'sandbox-logs',environment:'sandbox'}]});
  const policy=service.policy(),events=service.store.all('event');
  const preview=previewPolicyChange(policy,{expectedVersion:policy.version,sandboxAllowed:false,reason:'Restrict direct exports'});
  assert.deepEqual(preview.differences,[{field:'sandboxAllowed',before:true,after:false}]);assert.equal(preview.input.sandboxApprovalRequired,false);
  assert.equal(preview.beforeRules.find(rule=>rule.id==='INCIDENT-01')?.description,preview.afterRules.find(rule=>rule.id==='INCIDENT-01')?.description);assert.match(preview.afterRules.find(rule=>rule.id==='SANDBOX-04')!.description,/demo_export.send@2.4/);
  assert.deepEqual(service.policy(),policy);assert.deepEqual(service.store.all('event'),events);
  assert.throws(()=>previewPolicyChange(policy,{expectedVersion:policy.version-1,sandboxAllowed:true}),/Policy changed/);
 }finally{service.store.close();}
});
test('policy publication records reason and author, rejects invalid reasons and stale reviews',async()=>{
 const service=new Precedent(openStore(':memory:'),()=>12345);const initial=service.store.get('policy_version','1');
 const server=createApp(service,undefined,{async resolve(req){return {userId:'reviewer',role:req.headers['x-role']==='admin'?'admin':'employee',tenantId:'acme-demo'};}}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 const call=async(path:string,body:unknown,role='admin')=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-role':role},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 try{
  const input={expectedVersion:1,sandboxAllowed:false,reason:'Prevent unreviewed synthetic exports'};
  assert.equal((await call('/policy/preview',input,'employee')).status,403);
  const preview=await call('/policy/preview',input);assert.equal(preview.status,200);assert.equal(service.policy().version,1);
  assert.equal((await call('/policy',{...input,reason:'   '})).status,400);assert.equal(service.policy().version,1);
  const published=await call('/policy',preview.body.input);assert.equal(published.status,200);assert.equal(published.body.reason,input.reason);assert.equal(published.body.publishedBy,'reviewer');assert.equal(published.body.publishedAt,12345);assert.deepEqual(service.store.get('policy_version','1'),initial);
  const next=await call('/policy/preview',{expectedVersion:2,sandboxAllowed:true,reason:'Restore demo exports'});assert.equal(next.status,200);
  service.incident('example_connector.analyze');assert.equal((await call('/policy',next.body.input)).status,409);assert.equal(service.policy().sandboxAllowed,false);
  assert.equal((await call('/policy',{expectedVersion:3,sandboxAllowed:true,quarantined:[],reason:'Attempt to remove quarantine'})).status,400);assert.ok(service.policy().quarantined.includes('example_connector.analyze@2.4'));
  assert.match(service.store.get('policy_version','3').reason,/Quarantine example_connector.analyze@2.4/);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));service.store.close();}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';

const question='Weekly active customers by region last quarter';
async function harness(){
 const store=openStore(':memory:');const service=new Precedent(store);
 const server=createApp(service).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body?:unknown,token?:string)=>{const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};};
 const user=async(department?:string,role='employee')=>{const token=(await call('/login',{role})).data.token;if(department)assert.equal((await call('/me/department',{department},token)).status,200);return token;};
 const ask=async(token:string,mode:'governed'|'baseline',hint?:Record<string,string>,memory='full')=>(await call('/comparison',{task:question,scenario:'warehouse',planner:'fixture',target:mode,memory,...(hint?{hint}:{})},token)).data.runs[0];
 const queries=(run:any)=>store.all('execution').filter((e:any)=>run.executionIds.includes(e.id)||run.executionIds.includes(e.id.replace(/:resume$/,'')));
 const result=(e:any)=>store.get('receipt',e.receiptId)?.result??'';
 return {store,service,call,user,ask,queries,result,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}
const hint={table:'acme_dw.t_04417',definitions:'Active means at least one order in the trailing 7 days.'};

test('department is self-declared once, admin-only afterwards, and never accepted from action input',async()=>{
 const h=await harness();try{
  const token=(await h.call('/login',{role:'employee'})).data.token;
  assert.equal((await h.call('/me',undefined,token)).data.department,null);
  assert.equal((await h.call('/me/department',{department:'marketing'},token)).status,400);
  assert.equal((await h.call('/me/department',{department:'engineering'},token)).status,200);
  assert.equal((await h.call('/me/department',{department:'finance'},token)).status,409);
  assert.equal((await h.call('/me',undefined,token)).data.department,'engineering');
  const session=(await h.call('/sessions',{},token)).data;assert.equal(session.department,'engineering');
  assert.equal((await h.call('/actions',{sessionId:session.id,executionId:'x',toolId:'warehouse.query',resourceId:'warehouse',environment:'production',target:'finance.rev_by_cust',department:'finance'},token)).status,400,'clients cannot claim a department');
 }finally{await h.close();}
});

test('Plane B: first attempt finds nothing, a user hint answers, the checkpoint passes and only approval stores department memory',async()=>{
 const h=await harness();try{
  const eng1=await h.user('engineering'),other=await h.user('engineering');
  const first=await h.ask(eng1,'governed');const [miss]=h.queries(first);
  assert.equal(miss.action.target,'acme_dw.customers');assert.match(h.result(miss),/^0 rows/);
  assert.equal(h.store.all('memory_candidate').length,0,'a failure teaches nothing');
  const answered=await h.ask(eng1,'governed',{...hint,previousRunId:first.id});const [hit]=h.queries(answered);
  assert.equal(hit.action.target,'acme_dw.t_04417');assert.match(h.result(hit),/^12 rows/);
  const [candidate]=h.store.all('memory_candidate');
  assert.deepEqual([candidate.status,candidate.checkpoint.code,candidate.department],['PROPOSED','CHECKPOINT-OK','engineering']);
  assert.equal(h.store.all('knowledge').length,0,'agent learning alone stores nothing');
  assert.equal((await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'department'},other)).status,403,'only the requesting user approves');
  assert.equal((await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'company'},eng1)).status,400,'company-wide scope does not exist');
  assert.equal(h.store.get('memory_candidate',candidate.id).status,'PROPOSED','invalid input leaves the proposal open');
  const saved=await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'department'},eng1);
  assert.equal(saved.status,200);assert.equal(h.store.all('knowledge').length,1);
  assert.equal((await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'department'},eng1)).status,409,'a proposal is decided once');
 }finally{await h.close();}
});

test('approved memory is reused first time by the same department and never reaches another department',async()=>{
 const h=await harness();try{
  const eng1=await h.user('engineering');
  const first=await h.ask(eng1,'governed');await h.ask(eng1,'governed',{...hint,previousRunId:first.id});
  const [candidate]=h.store.all('memory_candidate');
  const approved=await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'department'},eng1);
  assert.equal(approved.status,200);assert.deepEqual([approved.data.department,approved.data.table,approved.data.scope],['engineering','acme_dw.t_04417','department']);
  // Scenario 3a: a second engineer, fresh session, no hint, no access to the first conversation.
  const eng2=await h.user('engineering');const reuse=await h.ask(eng2,'governed');
  const stored=h.store.get('run',reuse.id);assert.deepEqual(stored.knowledgeIds,[approved.data.id]);
  const [query]=h.queries(reuse);assert.equal(query.action.target,'acme_dw.t_04417');assert.match(h.result(query),/^12 rows/);
  assert.equal(h.store.all('memory_candidate').length,1,'reuse does not re-learn');
  // Scenario 3b: another department stays cold and cannot see the entry.
  const sales=await h.user('sales');const cold=await h.ask(sales,'governed');
  assert.deepEqual(h.store.get('run',cold.id).knowledgeIds,[]);assert.match(h.result(h.queries(cold)[0]),/^0 rows/);
  assert.equal((await h.call('/state',undefined,sales)).data.knowledge.length,0);assert.equal((await h.call('/state',undefined,eng2)).data.knowledge.length,1);
  const admin=await h.user(undefined,'admin');const comparison=(await h.call('/knowledge/'+approved.data.id+'/comparison',undefined,admin)).data;
  assert.deepEqual([comparison.learning.queries,comparison.learning.emptyResults,comparison.learning.userInterventions],[2,1,1]);
  assert.deepEqual([comparison.reuse.queries,comparison.reuse.emptyResults,comparison.reuse.userInterventions],[1,0,0]);
 }finally{await h.close();}
});

test('a finance-restricted table needs approval to query and the checkpoint keeps it out of non-finance memory',async()=>{
 const h=await harness();try{
  const eng1=await h.user('engineering'),admin=await h.user(undefined,'admin');
  const held=await h.ask(eng1,'governed',{table:'finance.rev_by_cust'});const [query]=h.queries(held);
  assert.deepEqual([query.status,query.decision.ruleId],['PENDING','DATA-31']);
  assert.equal((await h.call('/approvals/'+query.id,{allow:true,ttlSeconds:30},admin)).status,200);
  assert.equal((await h.call('/resume/'+query.id,{},eng1)).data.status,'SUCCEEDED');
  const [candidate]=h.store.all('memory_candidate');
  assert.deepEqual([candidate.status,candidate.checkpoint.code],['DENIED','CHECKPOINT-FIN-01']);
  assert.equal((await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'department'},eng1)).status,409,'approval cannot override a checkpoint denial');
  assert.equal(h.store.all('knowledge').length,0);assert.ok(h.store.all('event').some((e:any)=>e.type==='memory.checkpoint.denied'));
  // Finance itself may query its table without approval; another table cannot ride on an approval.
  const fin=await h.user('finance');assert.equal(h.queries(await h.ask(fin,'governed',{table:'finance.rev_by_cust'}))[0].status,'SUCCEEDED');
 }finally{await h.close();}
});

test('Plane A (no Precedent) answers with a hint but never learns, so the repeat fails again; warehouse data never becomes tenant-wide memory',async()=>{
 const h=await harness();try{
  const eng1=await h.user('engineering');
  await h.ask(eng1,'baseline');await h.ask(eng1,'baseline',hint);const repeat=await h.ask(eng1,'baseline');
  assert.match(h.result(h.queries(repeat)[0]),/^0 rows/);
  assert.equal(h.store.all('memory_candidate').length+h.store.all('knowledge').length,0);
  // Governed warehouse runs leave episodes, but they are excluded from general retrieval and playbooks.
  await h.ask(eng1,'governed',hint);assert.equal(h.store.all('playbook').length,0);
  const session=(await h.call('/sessions',{},eng1)).data;assert.equal(h.service.memoryCandidates(session.id,'warehouse').length,0);
 }finally{await h.close();}
});

test('a policy change that blocks a remembered table marks the entry for re-validation',async()=>{
 const h=await harness();try{
  const eng1=await h.user('engineering');const first=await h.ask(eng1,'governed');await h.ask(eng1,'governed',{...hint,previousRunId:first.id});
  const [candidate]=h.store.all('memory_candidate');await h.call('/memory/candidates/'+candidate.id+'/approve',{scope:'department'},eng1);
  h.service.publish({...h.service.policy(),deniedTools:['warehouse.query']},false,'Pause warehouse access');
  assert.equal(h.store.all('knowledge')[0].status,'NEEDS_REVALIDATION');
  const eng2=await h.user('engineering');assert.deepEqual(h.store.get('run',(await h.ask(eng2,'governed')).id).knowledgeIds,[]);
 }finally{await h.close();}
});

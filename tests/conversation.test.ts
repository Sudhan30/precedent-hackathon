import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {warehousePreview} from '../packages/warehouse/index.js';
import {rankKnowledge,type Knowledge} from '../packages/knowledge/index.js';

test('warehouse preview shows the most recent rows first and keeps the total count',()=>{
 const preview=warehousePreview('acme_dw.t_04417')!;
 assert.deepEqual([preview.rowCount,preview.rows.length,preview.columns],[12,5,['iso_week','region','active_customers']]);
 assert.deepEqual(preview.rows.slice(0,3).map(r=>r.region),['NA','EMEA','APAC']);
 assert.ok(preview.rows.slice(0,3).every(r=>r.iso_week===preview.rows[0].iso_week));
 assert.equal(warehousePreview('acme_dw.weekly_active_customers'),null,'an empty result has no preview');
 assert.equal(warehousePreview('nope.table'),null);
});

test('a follow-up that shares no words with saved memory still gets the department entries',async()=>{
 const entry={id:'k1',question:'Weekly active customers by region last quarter',table:'acme_dw.t_04417',definitions:'',approvedAt:1} as Knowledge;
 const ranked=await rankKnowledge('can you read that data',[entry],'');
 assert.deepEqual([ranked.engine,ranked.entries.map(k=>k.id)],['department-recent',['k1']]);
 const weak=await rankKnowledge('can you read that data',[entry],'key',(async()=>new Response(JSON.stringify({data:[{index:0,relevance_score:0.1}]}))) as typeof fetch);
 assert.equal(weak.engine,'department-recent');
 assert.equal((await rankKnowledge('Weekly active customers by region',[entry],'')).engine,'keyword');
 assert.equal((await rankKnowledge('anything',[],'')).entries.length,0,'no entries, no memory');
});

test('the planner sees this chat\'s earlier turns, never another user\'s',async()=>{
 const messages:any[]=[];
 const transport={health:async()=>({}),create:async({message}:{message:string})=>{const input=JSON.parse(message);messages.push(input);
  return {session:{state:{sessionId:'w-'+input.runId}},response:{result:async()=>({data:{goal:input.task,reply:'',steps:[{toolId:'internal_logs.search',purpose:'Search',policyReferences:[],memoryReferences:[]}]},events:[]})}};}};
 const store=openStore(':memory:');const server=createApp(new Precedent(store),undefined,undefined,undefined,undefined,undefined,undefined,transport as any).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body:unknown,token?:string)=>(await (await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)})).json()) as any;
 try{
  const employee=(await call('/login',{role:'employee'})).token,admin=(await call('/login',{role:'admin'})).token;
  const ask=async(task:string,token:string,previousRunIds?:string[])=>(await call('/comparison',{task,scenario:'investigation',planner:'eve',target:'governed',...(previousRunIds?{previousRunIds}:{})},token)).runs[0];
  const first=await ask('Investigate checkout errors for Globex',employee);assert.equal(first.status,'FINISHED');
  await ask('can you summarize that',employee,[first.id]);
  const turns=messages.at(-1).recentConversation;
  assert.equal(turns.length,1);assert.equal(turns[0].user,'Investigate checkout errors for Globex');
  assert.equal(turns[0].toolResults[0].toolId,'internal_logs.search');assert.match(turns[0].toolResults[0].result,/\S/);
  assert.match(messages.at(-1).responseGuidance,/recentConversation/);
  await ask('can you summarize that',admin,[first.id]);
  assert.equal(messages.at(-1).recentConversation,undefined,'another user\'s run is never shared');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});

test('a malformed table hint gets one readable sentence, not raw validation JSON',async()=>{
 const store=openStore(':memory:');const server=createApp(new Precedent(store)).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 try{
  const token=(await (await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json() as any).token;
  const ask=async(table:string)=>{const r=await fetch(url+'/comparison',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({task:'Weekly active customers by region',scenario:'warehouse',target:'governed',hint:{table}})});return {status:r.status,error:((await r.json()) as any).error};};
  assert.deepEqual(await ask('finance.restricted_revenue_by_customer.acme_dw.t_04417'),{status:400,error:'Enter one table as dataset.table, for example acme_dw.t_04417.'});
  assert.deepEqual(await ask('acme_dw.nope'),{status:400,error:'That table is not in the warehouse catalog. Check the name and try again.'});
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});

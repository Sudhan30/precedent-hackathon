import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {recommendMcp,priorityFor} from '../packages/mcp/recommend.js';

const clean={status:'OK' as const,events:4,negativeSignals:[],connectionAttempts:0,connectionErrors:0};
test('MCP-04 recommends from evidence: crowd + clean Raindrop → company-wide; flags or failures → one-time only; no Raindrop → requester count only',()=>{
 assert.deepEqual([priorityFor(1),priorityFor(2),priorityFor(3),priorityFor(7)],['Normal','Raised','High','High']);
 assert.deepEqual([recommendMcp({requesters:3,searchRelated:false,raindrop:clean}).action,recommendMcp({requesters:3,searchRelated:false,raindrop:clean}).priority],['approve-company','High']);
 assert.equal(recommendMcp({requesters:1,searchRelated:false,raindrop:clean}).action,'review');
 assert.match(recommendMcp({requesters:3,searchRelated:false,raindrop:{...clean,negativeSignals:['mcp_denied']}}).text,/one-time approvals only: Raindrop flagged mcp_denied/);
 assert.equal(recommendMcp({requesters:3,searchRelated:false,raindrop:{...clean,connectionAttempts:20,connectionErrors:2}}).action,'one-time-only','10% failed connections');
 assert.equal(recommendMcp({requesters:3,searchRelated:false,raindrop:{...clean,status:'UNAVAILABLE'}}).action,'review');
});

test('InfoSec evidence route, waiting count for a second requester, and approve/deny sent back to Raindrop as signals',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const signals:any[]=[];
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async()=>({status:'CONNECTED',tools:[],message:'test'}),undefined,async()=>({searchRelated:false,reason:'x',judge:'test',checkedAt:1}),undefined,async()=>clean,(signal:any)=>{signals.push(signal);}).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,token:string,body?:unknown)=>{const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json() as any};};
 const login=async(role:string)=>(await (await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).json() as any).token;
 try{
  const employee=await login('employee'),admin=await login('admin');
  const ask=async()=>{const run=(await call('/mcp/comparison',employee,{task:'https://mcp.sentry.dev/mcp',target:'governed'})).data.runs[0];return run.mcpResult.requestId as string;};
  const first=await ask();await call('/mcp/requests/'+first+'/submit',employee,{name:'Sentry',endpoint:'https://mcp.sentry.dev/mcp',purpose:'Investigate production errors'});
  const second=await ask();
  const demand=(await call('/state',employee)).data.mcpDemand.find((d:any)=>d.key==='sentry');assert.deepEqual([demand.count,demand.waiting],[1,1],'the second requester sees one request already waiting');
  const evidence=(await call('/mcp/requests/'+first+'/evidence',admin)).data;
  assert.deepEqual([evidence.requesters,evidence.raindrop.status,evidence.recommendation.ruleId,evidence.recommendation.priority],[1,'OK','MCP-04','Normal']);
  assert.equal((await call('/mcp/requests/'+first+'/evidence',employee)).status,403);
  await call('/mcp/requests/'+first+'/review',admin,{allow:false,scope:'once',expectedVersion:service.policy().version,reason:'Not needed',ttlSeconds:30});
  assert.deepEqual(signals.map(s=>[s.name,s.sentiment,s.properties.mcp]),[['mcp_denied','NEGATIVE','sentry']]);
  assert.equal(signals[0].eventId,store.get('mcp_request',first).runId,'feedback attaches to the request run event');
  void second;
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {keywordClassification,type McpClassificationInput} from '../packages/mcp/classify.js';
import {mcpConnectionDecision} from '../packages/mcp/decision.js';

// Test judge: anything mentioning "search" is an open-web search tool.
async function harness(){
 const store=openStore(':memory:');const service=new Precedent(store);const discovered:string[]=[];const judged:McpClassificationInput[]=[];
 const classify=async(input:McpClassificationInput)=>{judged.push(input);const hit=/search/i.test(JSON.stringify(input));return {searchRelated:hit,reason:hit?'Searches the open web.':'Works on one product.',judge:'test judge',checkedAt:1};};
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async url=>{discovered.push(url);return {status:'CONNECTED',tools:['t'],message:'Test discovery; no tool executed.'};},undefined,classify).listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body:unknown,token:string)=>{const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
 const login=async(role:string)=>(await (await fetch(url+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role})})).json() as any).token;
 const employee=await login('employee'),admin=await login('admin');
 const start=async(task:string)=>(await call('/mcp/comparison',{task,target:'governed'},employee)).data.runs[0];
 return {store,service,discovered,judged,call,employee,admin,start,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}

test('a web search MCP is blocked by policy MCP-03 at request time: no approval path, no connection',async()=>{
 const h=await harness();try{
  const run=await h.start('Install Parallel Search MCP');
  assert.deepEqual([run.mcpResult.status,run.mcpResult.decision.verdict,run.mcpResult.decision.ruleId],['BLOCKED','BLOCK','MCP-03']);
  assert.equal(run.mcpResult.requestId,undefined,'no approval request is created');
  assert.deepEqual([run.mcpResult.classification.searchRelated,run.mcpResult.classification.judge],[true,'test judge']);
  assert.equal(h.discovered.length,0);assert.equal(h.store.all('mcp_request').length,0);
  assert.ok(h.store.all('event').some((e:any)=>e.type==='mcp.policy.checked'));
 }finally{await h.close();}
});

test('a request that only reveals search at submit time is closed by policy, and an admin cannot approve it',async()=>{
 const h=await harness();try{
  const run=await h.start('Connect Helper MCP');assert.equal(run.mcpResult.decision.verdict,'REQUIRE_APPROVAL');
  const id=run.mcpResult.requestId;
  const submitted=(await h.call('/mcp/requests/'+id+'/submit',{name:'Helper',endpoint:'https://search-mcp.parallel.ai/mcp',purpose:'Answer questions from the web'},h.employee)).data;
  assert.deepEqual([submitted.mcpResult.status,submitted.mcpResult.decision.ruleId],['BLOCKED','MCP-03']);
  assert.equal(h.store.get('mcp_request',id).status,'DENIED');
  assert.equal((await h.call('/mcp/requests/'+id+'/review',{allow:true,scope:'once',expectedVersion:h.service.policy().version,reason:'try',ttlSeconds:30},h.admin)).status,409);
  assert.equal(h.discovered.length,0);
 }finally{await h.close();}
});

test('other MCPs keep the approval flow after the policy check',async()=>{
 const h=await harness();try{
  const run=await h.start('Connect Linear MCP');const id=run.mcpResult.requestId;
  assert.equal(run.mcpResult.classification.searchRelated,false);
  const submitted=(await h.call('/mcp/requests/'+id+'/submit',{name:'Linear',endpoint:'https://mcp.linear.app/mcp',purpose:'Read our issue tracker'},h.employee)).data;
  assert.deepEqual([submitted.mcpResult.status,submitted.mcpResult.decision.verdict],['PENDING_APPROVAL','REQUIRE_APPROVAL']);
  assert.equal((await h.call('/mcp/requests/'+id+'/review',{allow:true,scope:'once',expectedVersion:h.service.policy().version,reason:'ok',ttlSeconds:30},h.admin)).status,200);
  assert.equal((await h.call('/mcp/requests/'+id+'/resume',{},h.employee)).data.mcpResult.status,'CONNECTED');
  assert.equal(h.judged.length,2,'checked at request and at submit');
 }finally{await h.close();}
});

test('the MCP-03 rule outranks a company allow, and the keyword fallback recognizes search tools',()=>{
 const policy={...new Precedent(openStore(':memory:')).policy()};
 const allowed={...policy,mcpConnections:[...(policy.mcpConnections??[]),{key:'parallel-search',name:'Parallel Search',endpoint:'https://search-mcp.parallel.ai/mcp',allowed:true}]};
 assert.equal(mcpConnectionDecision(allowed,'Parallel Search').verdict,'ALLOW');
 assert.equal(mcpConnectionDecision(allowed,'Parallel Search',undefined,{searchRelated:true}).ruleId,'MCP-03');
 assert.equal(keywordClassification({name:'Parallel Search',endpoint:'https://search-mcp.parallel.ai/mcp'}).searchRelated,true);
 assert.equal(keywordClassification({name:'Docs Preview',endpoint:'https://developer.tenable.com/mcp',purpose:'Read developer documentation'}).searchRelated,false);
});

test('a pasted MCP link or install command is an MCP request, with name and endpoint filled in',async()=>{
 const {isMcpConnectionPrompt,nameFromPrompt,endpointFromPrompt}=await import('../packages/mcp/contracts.js');
 assert.deepEqual([isMcpConnectionPrompt('https://mcp.sentry.dev/mcp'),nameFromPrompt('https://mcp.sentry.dev/mcp'),endpointFromPrompt('https://mcp.sentry.dev/mcp')],[true,'Sentry','https://mcp.sentry.dev/mcp']);
 assert.equal(nameFromPrompt(`code --add-mcp '{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}'`),'Playwright');
 assert.equal(nameFromPrompt('claude mcp add --transport http sentry https://mcp.sentry.dev/mcp'),'Sentry');
 assert.equal(isMcpConnectionPrompt('check https://example.com/blog for errors'),false,'an ordinary link stays a chat message');
 const h=await harness();try{
  const run=await h.start('https://mcp.sentry.dev/mcp');
  assert.equal(run.mcpResult.decision.verdict,'REQUIRE_APPROVAL');
  assert.deepEqual([h.store.get('mcp_request',run.mcpResult.requestId).name,h.store.get('mcp_request',run.mcpResult.requestId).endpoint],['Sentry','https://mcp.sentry.dev/mcp']);
 }finally{await h.close();}
});

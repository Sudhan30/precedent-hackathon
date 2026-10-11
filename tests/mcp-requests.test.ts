import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {endpointSchema,nameFromPrompt} from '../packages/mcp/contracts.js';
import {publicAddress,publicMcpFetch} from '../packages/mcp/public-fetch.js';

async function harness(discover?:(endpoint:string)=>Promise<any>){
 const store=openStore(':memory:');let now=Date.now();const service=new Precedent(store,()=>now);const calls:string[]=[];
 const server=createApp(service,undefined,undefined,undefined,undefined,undefined,async endpoint=>{calls.push(endpoint);return discover?discover(endpoint):{status:'CONNECTED',tools:['search'],message:'Test discovery; no tool executed.'};}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body?:unknown,token?:string)=>{const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};};
 const employee=(await call('/login',{role:'employee'})).data.token,other=(await call('/login',{role:'employee'})).data.token,admin=(await call('/login',{role:'admin'})).data.token;
 const start=async(target='governed')=>(await call('/mcp/comparison',{task:'Connect with Prometheus MCP',target},employee)).data.runs[0];
 const submit=async(run:any)=>call('/mcp/requests/'+run.mcpResult.requestId+'/submit',{name:'Prometheus',endpoint:'https://mcp.example.com/mcp',purpose:'Investigate metrics'},employee);
 const review=(id:string,allow=true,scope='once')=>call('/mcp/requests/'+id+'/review',{allow,scope,expectedVersion:service.policy().version,reason:'Reviewed metrics documentation access',ttlSeconds:30},admin);
 return {store,service,calls,call,employee,other,admin,start,submit,review,advance:(ms:number)=>{now+=ms;},close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}
test('unknown MCP is held until explicit submission, admin approval and owner resume; grants are one-use',async()=>{
 const h=await harness();try{
 const run=await h.start(),id=run.mcpResult.requestId;assert.equal(run.mcpResult.status,'CONFIGURATION_REQUIRED');assert.equal(h.calls.length,0);
 let state=(await h.call('/state',undefined,h.employee)).data;assert.equal(state.mcpRequests[0].status,'DRAFT');assert.equal(state.approvals.length,0);
 assert.equal((await h.call('/mcp/requests/'+id+'/submit',{name:'Prometheus',endpoint:'https://mcp.example.com/mcp',purpose:'Metrics'},h.other)).status,403);
 assert.equal((await h.submit(run)).status,200);assert.equal(h.calls.length,0);
 assert.equal((await h.call('/mcp/requests/'+id+'/review',{allow:true,scope:'once',expectedVersion:1,reason:'Not admin'},h.employee)).status,403);
 assert.equal((await h.call('/mcp/requests/'+id+'/resume',{},h.employee)).status,409);
 assert.equal((await h.review(id)).status,200);assert.equal(h.calls.length,0);
 assert.equal((await h.call('/mcp/requests/'+id+'/resume',{},h.other)).status,403);
 const responses=await Promise.all([h.call('/mcp/requests/'+id+'/resume',{},h.employee),h.call('/mcp/requests/'+id+'/resume',{},h.employee)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.deepEqual(h.calls,['https://mcp.example.com/mcp']);
 assert.equal(responses.find(r=>r.status===200)!.data.mcpResult.status,'CONNECTED');assert.equal(h.store.get('mcp_request',id).status,'CONSUMED');assert.equal(h.store.all('receipt').length,0);
 state=(await h.call('/state',undefined,h.employee)).data;assert.equal(state.mcpRequests[0].status,'CONSUMED');assert.ok(state.events.some((event:any)=>event.type==='mcp.connection.recorded'));
 }finally{await h.close();}
});
test('cancel and denial perform no connection and close requests',async()=>{
 const h=await harness();try{
 for(const pending of [false,true]){const run=await h.start(),id=run.mcpResult.requestId;if(pending)await h.submit(run);assert.equal((await h.call('/mcp/requests/'+id+'/cancel',{},h.employee)).status,200);assert.equal(h.store.get('mcp_request',id).status,'CANCELLED');assert.equal((await h.review(id)).status,409);}
 const run=await h.start(),id=run.mcpResult.requestId;await h.submit(run);await h.review(id,false);assert.equal(h.store.get('run',run.id).mcpResult.status,'DENIED');assert.equal((await h.call('/mcp/requests/'+id+'/resume',{},h.employee)).status,409);assert.equal(h.calls.length,0);
 }finally{await h.close();}
});
test('MCP approvals expire and stale policy or archived sessions cannot authorize connection',async()=>{
 const h=await harness();try{
 let run=await h.start();await h.submit(run);await h.review(run.mcpResult.requestId);h.advance(30001);
 const expired=await h.call('/mcp/requests/'+run.mcpResult.requestId+'/resume',{},h.employee);assert.equal(expired.data.mcpResult.status,'EXPIRED');assert.equal(h.calls.length,0);
 run=await h.start();await h.submit(run);h.service.publish({...h.service.policy(),sandboxAllowed:false});assert.equal((await h.review(run.mcpResult.requestId)).status,409);
 run=await h.start();await h.submit(run);await h.review(run.mcpResult.requestId);h.service.publish({...h.service.policy(),sandboxAllowed:true});assert.equal((await h.call('/mcp/requests/'+run.mcpResult.requestId+'/resume',{},h.employee)).status,409);
 h.service.resetDemo(h.service.policy().version,h.service.demo().demoRunId);assert.equal((await h.call('/mcp/requests/'+run.mcpResult.requestId+'/cancel',{},h.employee)).status,409);assert.equal(h.calls.length,0);
 }finally{await h.close();}
});
test('company approval stores a reviewed exact endpoint and later block prevents governed discovery',async()=>{
 const h=await harness();try{
 const run=await h.start(),id=run.mcpResult.requestId;await h.submit(run);await h.review(id,true,'company');assert.equal(h.service.policy().version,2);assert.equal(h.store.get('policy_version','2').mcpConnections[0].endpoint,'https://mcp.example.com/mcp');assert.equal(h.calls.length,0);
 await h.call('/mcp/requests/'+id+'/resume',{},h.employee);assert.equal(h.calls.length,1);
 const fresh=await h.start();assert.equal(fresh.mcpResult.status,'CONNECTED');assert.equal(h.calls.length,2);
 const body={allowed:false,expectedVersion:2,reason:'Disable metrics MCP'};
 assert.equal((await h.call('/mcp/connections/prometheus',body,h.employee)).status,403);assert.equal((await h.call('/mcp/connections/prometheus',body,h.admin)).status,200);assert.equal((await h.call('/mcp/connections/prometheus',body,h.admin)).status,409);
 assert.equal((await h.start()).mcpResult.status,'BLOCKED');assert.equal(h.calls.length,2);assert.equal((await h.start('baseline')).mcpResult.status,'CONNECTED');assert.equal(h.calls.length,3);
 assert.equal(h.store.get('policy_version','2').mcpConnections[0].allowed,true);assert.equal(h.store.get('policy_version','3').mcpConnections[0].allowed,false);
 }finally{await h.close();}
});
test('company denial remembers the blocked endpoint; baseline configuration does not grant governed access',async()=>{
 const h=await harness();try{
 const baseline=await h.start('baseline');await h.submit(baseline);assert.equal(h.calls.length,1);assert.equal((h.service.policy().mcpConnections??[]).length,0);
 const run=await h.start();await h.submit(run);await h.review(run.mcpResult.requestId,false,'company');assert.equal((await h.start()).mcpResult.status,'BLOCKED');assert.equal(h.calls.length,1);
 }finally{await h.close();}
});
test('network failures remain sanitized and a policy change during discovery discards tools',async()=>{
 let h:Awaited<ReturnType<typeof harness>>;let mutate=false;
 h=await harness(async()=>{if(!mutate)throw new Error('secret provider diagnostic');h.service.publish({...h.service.policy(),sandboxAllowed:false});return {status:'CONNECTED',tools:['search'],message:'Returned discovery'};});try{
 for(const change of [false,true]){mutate=change;const run=await h.start();await h.submit(run);await h.review(run.mcpResult.requestId);const result=await h.call('/mcp/requests/'+run.mcpResult.requestId+'/resume',{},h.employee);assert.equal(result.data.mcpResult.status,change?'POLICY_CHANGED':'CONNECTION_FAILED');assert.deepEqual(result.data.mcpResult.tools,[]);assert.ok(!JSON.stringify(result.data).includes('secret provider'));}
 }finally{await h.close();}
});
test('public endpoint validation rejects embedded secrets, private addresses, redirects and DNS rebinding targets',async()=>{
 assert.equal(nameFromPrompt('connect with prometheus mcp'),'prometheus');
 for(const endpoint of ['http://example.com/mcp','https://localhost/mcp','https://127.0.0.1/mcp','https://[::1]/mcp','https://example.internal/mcp','https://user:pass@example.com/mcp','https://example.com/mcp?api_key=secret','https://example.com:8443/mcp'])assert.equal(endpointSchema.safeParse(endpoint).success,false);
 for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.1.2','192.168.1.2','100.64.1.2','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
 assert.equal(publicAddress('1.1.1.1'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(publicMcpFetch('https://example.com/mcp')('https://other.example.com/mcp'));
 const privateDns=publicMcpFetch('https://mcp.example.com/mcp',async()=>[{address:'127.0.0.1',family:4}]);await assert.rejects(privateDns('https://mcp.example.com/mcp'),/public addresses/);
 const mixedDns=publicMcpFetch('https://mcp.example.com/mcp',async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}]);await assert.rejects(mixedDns('https://mcp.example.com/mcp'),/public addresses/);
});

test('MCP requests survive Mongo restart and native identity isolates ownership and tenant review',{skip:!process.env.TEST_MONGODB_URI},async()=>{
 const {MongoRuntime}=await import('../apps/server/runtime.js');const {withDatabase}=await import('../packages/database/uri.js');
 const uri=withDatabase(process.env.TEST_MONGODB_URI!,'pv_mcp_'+crypto.randomUUID().replaceAll('-','').slice(0,16));
 let runtime=await MongoRuntime.connect(uri);let calls=0;
 const identity={async resolve(req:any){const key=req.headers.authorization;return key==='owner'?{userId:'owner',role:'employee' as const,tenantId:'acme-demo'}:key==='other'?{userId:'other',role:'employee' as const,tenantId:'acme-demo'}:key==='admin'?{userId:'admin',role:'admin' as const,tenantId:'acme-demo'}:key==='wrong-tenant'?{userId:'admin-elsewhere',role:'admin' as const,tenantId:'elsewhere'}:null;}};
 let server:ReturnType<ReturnType<typeof createApp>['listen']>;
 const start=async()=>{server=createApp(runtime,undefined,identity,undefined,undefined,undefined,async()=>{calls++;return {status:'CONNECTED',tools:['search'],message:'Test discovery'};}).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));};
 const stop=()=>new Promise<void>(resolve=>server.close(()=>resolve()));
 const call=async(path:string,body:unknown,key:string)=>{const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api`+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:key},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};};
 try{
 await start();const run=(await call('/mcp/comparison',{task:'Connect Prometheus MCP',target:'governed'},'owner')).data.runs[0],id=run.mcpResult.requestId;
 await call('/mcp/requests/'+id+'/submit',{name:'Prometheus',endpoint:'https://mcp.example.com/mcp',purpose:'Metrics review'},'owner');
 assert.equal((await call('/state',undefined,'other')).data.mcpRequests.length,0);
 const body={allow:true,scope:'once',expectedVersion:1,reason:'Reviewed endpoint',ttlSeconds:300};
 assert.equal((await call('/mcp/requests/'+id+'/review',body,'wrong-tenant')).status,403);
 assert.equal((await call('/mcp/requests/'+id+'/review',body,'admin')).status,200);
 await stop();await runtime.close();runtime=await MongoRuntime.connect(uri);await start();
 const state=(await call('/state',undefined,'owner')).data;assert.equal(state.mcpRequests[0].status,'APPROVED');assert.equal(state.mcpRequests[0].requesterId,'owner');
 assert.equal((await call('/mcp/requests/'+id+'/resume',{},'other')).status,403);
 assert.equal((await call('/mcp/requests/'+id+'/resume',{},'owner')).data.mcpResult.status,'CONNECTED');assert.equal(calls,1);
 assert.equal((await call('/mcp/requests/'+id+'/resume',{},'owner')).status,409);
 }finally{await stop();await runtime.close();}
});

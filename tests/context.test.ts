import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../apps/server/store.js';
import {Precedent} from '../apps/server/service.js';
import {LocalRuntime,MongoRuntime,type DomainRuntime} from '../apps/server/runtime.js';
import {retrieveForRuntime} from '../apps/server/context.js';
import {withDatabase} from '../packages/database/uri.js';

function delayedProvider(){
 let release!:()=>void,started!:()=>void,calls=0;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const fetcher:typeof fetch=async(url,options)=>{
  calls++;if(calls===1){started();await gate;}
  const body=JSON.parse(String(options?.body));
  return Response.json(String(url).endsWith('/rerank')?{data:body.documents.slice(0,body.top_k).map((_:string,index:number)=>({index,relevance_score:1}))}:{data:body.input.map((_:string,index:number)=>({index,embedding:[1,0]}))});
 };
 return {fetcher,ready,release:()=>release(),calls:()=>calls};
}

async function changedPolicy(runtime:DomainRuntime){
 const session=await runtime.run(service=>service.session());
 const initial=await runtime.run(service=>service.policy());
 const provider=delayedProvider();
 const pending=retrieveForRuntime(runtime,session.id,'sandbox-logs','sandbox',{key:'test',fetcher:provider.fetcher});
 const rejected=assert.rejects(pending,error=>(error as {status?:number}).status===409);
 await provider.ready;
 // Publication must finish while the provider remains pending.
 let timer:ReturnType<typeof setTimeout>|undefined;
 const publication=runtime.run(service=>service.publish({...service.policy(),sandboxAllowed:false}));
 try{await Promise.race([publication,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Publication did not finish while provider was held')),runtime.mode.startsWith('MongoDB')?30000:5000);})]);}
 catch(error){provider.release();await Promise.allSettled([publication,rejected]);throw error;}
 finally{clearTimeout(timer);provider.release();}
 await rejected;
 assert.equal(provider.calls(),3);
 const records=await runtime.run(service=>({policy:service.policy(),rules:service.store.all('policy_rule'),executions:service.store.all('execution').filter(e=>e.action.sessionId===session.id)}));
 assert.equal(records.policy.version,initial.version+1);
 assert.ok(records.rules.filter(rule=>rule.policyVersion===initial.version).every(rule=>!rule.embedding));
 assert.equal(records.executions.length,0);
}

test('policy publication proceeds during retrieval and stale context cannot plan',{timeout:10000},async()=>{
 const runtime=new LocalRuntime(new Precedent(openStore(':memory:')));
 try{await changedPolicy(runtime);}finally{await runtime.close();}
});
test('MongoDB publication is not queued behind external retrieval',{skip:!process.env.TEST_MONGODB_URI,timeout:120000},async()=>{
 const uri=withDatabase(process.env.TEST_MONGODB_URI!,'pv_context_'+crypto.randomUUID().replaceAll('-','').slice(0,16));
 const runtime=await MongoRuntime.connect(uri);
 try{await changedPolicy(runtime);}finally{await runtime.close();}
});
test('scope changes invalidate context and cache merges retain concurrent metadata',async()=>{
 const service=new Precedent(openStore(':memory:')),runtime=new LocalRuntime(service);
 try{
  const writer=service.session();service.execute(service.action(writer.id,'internal_logs.search','customer-logs','production'),'context-evidence');
  const session=service.session();let provider=delayedProvider();
  let pending=retrieveForRuntime(runtime,session.id,'customer-logs','checkout',{key:'test',fetcher:provider.fetcher});
  await provider.ready;
  const episode=service.store.all('episode')[0];service.store.put('episode',{...episode,reviewNote:'concurrent review'});provider.release();
  const context=await pending;assert.equal(context.policy.version,service.policy().version);
  assert.ok(service.store.get('episode',episode.id).embedding);assert.equal(service.store.get('episode',episode.id).reviewNote,'concurrent review');
  assert.ok(!('embedding' in context.episodes[0]));
  provider=delayedProvider();pending=retrieveForRuntime(runtime,session.id,'customer-logs','checkout',{key:'test',fetcher:provider.fetcher});
  const rejected=assert.rejects(pending,error=>(error as {status?:number}).status===409);
  await provider.ready;service.store.put('session',{...service.store.get('session',session.id)!,role:'admin'});provider.release();await rejected;
 }finally{await runtime.close();}
});
test('unknown sessions make no provider calls',async()=>{
 const runtime=new LocalRuntime(new Precedent(openStore(':memory:')));let calls=0;
 try{await assert.rejects(retrieveForRuntime(runtime,'unknown','customer-logs','checkout',{key:'test',fetcher:async()=>{calls++;throw new Error('unexpected');}}),/Unknown session/);assert.equal(calls,0);}finally{await runtime.close();}
});

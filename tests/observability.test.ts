import {test} from 'node:test';import assert from 'node:assert/strict';
import {InMemorySpanExporter,SimpleSpanProcessor} from '@opentelemetry/sdk-trace-base';
import {BackendTelemetry,TelemetryRuntime,configuredTelemetry,eventAttributes} from '../packages/observability/index.js';
import {LocalRuntime} from '../apps/server/runtime.js';import {Precedent} from '../apps/server/service.js';import {openStore} from '../apps/server/store.js';
import {createApp} from '../apps/server/api.js';import {ExecutionGateway} from '../packages/execution/index.js';import {connectConnector} from '../packages/demo-tools/client.js';
import {linkRaindropSpan} from '../packages/observability/raindrop-span.js';
test('Raindrop worker linkage preserves span identity, redaction and original attributes',()=>{
 const original={attributes:{'ai.settings.context.raindrop.eventId':'precedent-worker:session-1','ai.settings.context.raindrop.ai.userId':'precedent-agent','ai.settings.context.raindrop.convoId':'session-1','gen_ai.operation.name':'chat'},spanContext(){assert.equal(this,original);return {traceId:'original-trace',spanId:'original-span'};}};
 const linked=linkRaindropSpan(original);
 assert.equal(linked.attributes['ai.telemetry.metadata.raindrop.eventId' as keyof typeof linked.attributes],'precedent-worker:session-1');
 assert.equal(linked.attributes['ai.telemetry.metadata.raindrop.ai.userId' as keyof typeof linked.attributes],'precedent-agent');
 assert.deepEqual(linked.spanContext(),original.spanContext());
 assert.equal(Object.keys(original.attributes).length,4);
 assert.equal(linked.attributes['gen_ai.operation.name'],'chat');
 assert.ok(!Object.keys(linked.attributes).some(key=>/input|output|prompt|response/.test(key)));
 const noContext={attributes:{'gen_ai.operation.name':'chat'}};assert.deepEqual(linkRaindropSpan(noContext).attributes,noContext.attributes);
});
test('concurrent API comparisons export correlated committed decisions and receipts without task contents',async()=>{
 const exporter=new InMemorySpanExporter(),telemetry=new BackendTelemetry(exporter,new SimpleSpanProcessor(exporter));
 const service=new Precedent(openStore(':memory:')),runtime=new TelemetryRuntime(new LocalRuntime(service),telemetry),connector=await connectConnector(':memory:'),gateway=new ExecutionGateway(runtime,connector);
 const server=createApp(runtime,gateway,undefined,telemetry).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
 try{
  const {token}=await(await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'employee'})})).json();
  const response=await fetch(base+'/comparison',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({task:'PRIVATE-TASK-DO-NOT-EXPORT',scenario:'investigation'})});assert.equal(response.status,200);const {runs}=await response.json();await telemetry.flush();
  const spans=exporter.getFinishedSpans(),roots=spans.filter(span=>span.name==='precedent.run');assert.equal(roots.length,2);assert.notEqual(roots[0].spanContext().traceId,roots[1].spanContext().traceId);
  for(const run of runs){const root=roots.find(span=>span.attributes['precedent.run_id']===run.id)!;assert.ok(root);const children=spans.filter(span=>span.name!=='precedent.run'&&span.attributes['precedent.run_id']===run.id);
   for(const type of ['run.created','planning.started','plan.created','decision.recorded','execution.completed','run.completed'])assert.ok(children.some(span=>span.name==='precedent.'+type),type);
   assert.ok(children.every(span=>span.spanContext().traceId===root.spanContext().traceId&&span.parentSpanContext?.spanId===root.spanContext().spanId));
   assert.equal(root.attributes['ai.telemetry.metadata.raindrop.eventId'],run.id);assert.ok(children.every(span=>span.attributes['ai.telemetry.metadata.raindrop.eventId']===run.id));
   for(const execution of run.executions){const decision=children.find(span=>span.name==='precedent.decision.recorded'&&span.attributes['precedent.execution_id']===execution.id)!;assert.ok(decision);assert.equal(decision.attributes['precedent.policy_version'],execution.decision.policyVersion);assert.equal(decision.attributes['precedent.verdict'],execution.decision.verdict);
    const completed=children.find(span=>span.name==='precedent.execution.completed'&&span.attributes['precedent.execution_id']===execution.id);if(execution.status==='BLOCKED'){assert.equal(completed,undefined);assert.equal(execution.receiptId,null);}else{assert.ok(completed);assert.equal(completed.attributes['precedent.receipt_id'],execution.receiptId);}
   }
  }
  assert.ok(!JSON.stringify(spans.map(span=>({attributes:span.attributes,status:span.status}))).includes('PRIVATE-TASK-DO-NOT-EXPORT'));
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await connector.close();await runtime.close();await telemetry.close();}
});
test('rolled-back writes export no event; successful transaction exports it once',async()=>{
 const exporter=new InMemorySpanExporter(),telemetry=new BackendTelemetry(exporter,new SimpleSpanProcessor(exporter)),service=new Precedent(openStore(':memory:')),runtime=new TelemetryRuntime(new LocalRuntime(service),telemetry);
 try{await assert.rejects(runtime.run(s=>s.store.atomic(()=>{s.emit('policy.published',{version:99});throw new Error('rollback');})),/rollback/);assert.equal(exporter.getFinishedSpans().length,0);
  await runtime.run(s=>s.store.atomic(()=>s.emit('policy.published',{version:2})));await telemetry.flush();const spans=exporter.getFinishedSpans();assert.equal(spans.length,1);assert.equal(spans[0].attributes['precedent.policy_version'],2);
 }finally{await runtime.close();await telemetry.close();}
});
test('optional exporter failures do not change execution and attributes exclude sensitive fields',async()=>{
 assert.equal(configuredTelemetry(''),undefined);
 const sensitive='SECRET-DO-NOT-EXPORT';const attributes=eventAttributes({type:'run.failed',id:'e',runId:'r',phase:'planning',task:sensitive,context:{summary:sensitive,retrieval:{degraded:true}},receipt:{result:sensitive},error:sensitive,Authorization:sensitive,reason:sensitive});assert.ok(!JSON.stringify(attributes).includes(sensitive));
 let attempts=0;const exporter={export(_spans:unknown,callback:(result:{code:number;error?:Error})=>void){attempts++;callback({code:1,error:new Error(sensitive)});},async shutdown(){}};
 const telemetry=new BackendTelemetry(exporter,new SimpleSpanProcessor(exporter)),service=new Precedent(openStore(':memory:')),runtime=new TelemetryRuntime(new LocalRuntime(service),telemetry);
 try{const session=service.session();const gateway=new ExecutionGateway(runtime,{async execute(){return {result:'fixture'};},async receipts(){return [];}});const result=await telemetry.run({runId:'run',demoRunId:service.demo().demoRunId,mode:'governed'},()=>gateway.execute(service.action(session.id,'internal_logs.search','customer-logs','production'),'allowed'));assert.equal(result.status,'SUCCEEDED');assert.ok(attempts>0);assert.equal(service.store.all('receipt').length,1);
 }finally{await runtime.close();await telemetry.close();}
});
test('telemetry wrapper keeps the read path and write counter of the runtime it wraps',async()=>{
 const service=new Precedent(openStore(':memory:'));const reads:string[]=[];
 const source={...new LocalRuntime(service),mode:'test',writes:7,run:async(fn:any)=>fn(service),read:async(fn:any)=>{reads.push('read');return fn(service);},close:async()=>undefined};
 const wrapped=new TelemetryRuntime(source,new BackendTelemetry(new InMemorySpanExporter()));
 assert.equal(wrapped.writes,7);assert.equal(await wrapped.read!(s=>s.policy().version),service.policy().version);assert.deepEqual(reads,['read']);
 assert.equal(new TelemetryRuntime({...source,read:undefined},new BackendTelemetry(new InMemorySpanExporter())).read,undefined);
 service.store.close();
});
test('each run sends one Raindrop event keyed by the run ID, with verdicts and no task text',async()=>{
 const sent:any[]=[];const telemetry=new BackendTelemetry(new InMemorySpanExporter(),undefined,async events=>{sent.push(...events);});
 telemetry.trackRun({runId:'run-1',mode:'governed',scenario:'warehouse',status:'FINISHED',executions:[{action:{toolId:'warehouse.query'},status:'SUCCEEDED',decision:{verdict:'ALLOW',ruleId:'INTERNAL-02'}},{action:{toolId:'demo_export.send'},status:'BLOCKED',decision:{verdict:'BLOCK',ruleId:'DATA-18'}}]});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,1);assert.equal(sent[0].event_id,'run-1');assert.equal(sent[0].properties.allowed,1);assert.equal(sent[0].properties.blocked,1);
 assert.deepEqual(sent[0].ai_data.tool_calls.map((call:any)=>call.result),['ALLOW INTERNAL-02','BLOCK DATA-18']);
 assert.ok(!JSON.stringify(sent).includes('Weekly active'));
 new BackendTelemetry(new InMemorySpanExporter()).trackRun({runId:'run-2',mode:'baseline',scenario:'investigation',status:'FAILED',executions:[]});
});

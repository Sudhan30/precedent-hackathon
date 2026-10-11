import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {OTLPHttpJsonTraceExporter} from '@vercel/otel';
import {SimpleSpanProcessor,type SpanExporter} from '@opentelemetry/sdk-trace-base';
import {BackendTelemetry,TelemetryRuntime} from '../packages/observability/index.js';
import {LocalRuntime} from '../apps/server/runtime.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {ExecutionGateway} from '../packages/execution/index.js';
import {connectConnector} from '../packages/demo-tools/client.js';
import {verifyRaindropEvent} from '../packages/observability/raindrop-query.js';

// Verify actual OTLP transport and controlled MCP execution, without model calls
// or writes to the application's retained database. No secrets enter output.
const key=process.env.RAINDROP_WRITE_KEY;
if(!key)throw new Error('Configure RAINDROP_WRITE_KEY in ignored .env.local first.');
const transport=new OTLPHttpJsonTraceExporter({url:'https://api.raindrop.ai/v1/traces',headers:{Authorization:'Bearer '+key}});
const exports:{code:number;spanCount:number;traceIds:string[]}[]=[];
const exporter:SpanExporter={export(spans,callback){transport.export(spans,result=>{exports.push({code:result.code,spanCount:spans.length,traceIds:[...new Set(spans.map(span=>span.spanContext().traceId))]});callback(result);});},shutdown(){return transport.shutdown();}};
const telemetry=new BackendTelemetry(exporter,new SimpleSpanProcessor(exporter));
const service=new Precedent(openStore(':memory:'));
const runtime=new TelemetryRuntime(new LocalRuntime(service),telemetry);
const connector=await connectConnector(':memory:');
const runId='raindrop-verification-'+randomUUID();
try{
 const session=await runtime.run(s=>s.session(undefined,undefined,runId));
 const result=await telemetry.run({runId,mode:'governed',demoRunId:service.demo().demoRunId},()=>new ExecutionGateway(runtime,connector).execute(service.action(session.id,'example_connector.analyze','sandbox-logs','sandbox'),'raindrop-execution-'+randomUUID()));
 assert.equal(result.status,'SUCCEEDED');assert.ok(result.receiptId);
 const receipts=await connector.receipts();assert.ok(receipts.some(receipt=>receipt.executionId===result.id));
 await telemetry.flush();
 assert.ok(exports.length>0);assert.ok(exports.every(item=>item.code===0),'Raindrop trace exporter rejected a batch');
 const evidence={checkedAt:new Date().toISOString(),runId,status:result.status,receiptMatched:true,exportAccepted:true,exports,queryVisibilityVerified:false,queryProof:undefined as Awaited<ReturnType<typeof verifyRaindropEvent>>|undefined};
 if(process.env.RAINDROP_QUERY_API_KEY){
  // Trace indexing is asynchronous. Only an empty response is retryable;
  // rejected credentials, malformed data and connection errors fail directly.
  const deadline=Date.now()+90000;
  for(;;){try{evidence.queryProof=await verifyRaindropEvent(runId,process.env.RAINDROP_QUERY_API_KEY);if(evidence.queryProof.spanCount<exports.reduce((count,item)=>count+item.spanCount,0))throw new Error('Raindrop has no visible spans for this event yet.');evidence.queryVisibilityVerified=true;break;}catch(error){if(!(error instanceof Error)||error.message!=='Raindrop has no visible spans for this event yet.'||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,2000));}}
 }
 mkdirSync('.data',{recursive:true});writeFileSync('.data/raindrop-trace-verification.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}finally{await connector.close();await runtime.close();await telemetry.close();}

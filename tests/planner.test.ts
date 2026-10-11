import {test} from 'node:test';import assert from 'node:assert/strict';
import {planWithEve,type PlannerTransport} from '../apps/agent-worker/planner.js';
test('planner correlation uses fresh worker sessions and injects company context only for governed turns',async()=>{
 const messages:Record<string,unknown>[]=[],ids:string[]=[];let count=0;
 const plan={goal:'Investigate checkout',steps:[{toolId:'internal_logs.search',purpose:'Inspect permitted logs',policyReferences:[],memoryReferences:[]}]};
 const transport:PlannerTransport={async health(){return {ok:true};},async create(input){messages.push(JSON.parse(input.message));const sessionId='worker-'+(++count);return {session:{state:{sessionId}},response:{async result(){assert.ok(ids.includes(sessionId));return {data:plan};}}};}};
 const baseline=await planWithEve('Investigate','customer-logs','production',null,{runId:'baseline-run',transport,onSession:async id=>{ids.push(id);}});
 const context={policy:{version:2},currentRules:[],episodes:[]};
 const governed=await planWithEve('Investigate','customer-logs','production',context,{runId:'governed-run',transport,onSession:async id=>{ids.push(id);}});
 assert.deepEqual(ids,['worker-1','worker-2']);assert.equal(messages[0].runId,'baseline-run');assert.ok(!('companyContext' in messages[0]));assert.equal(messages[1].runId,'governed-run');assert.deepEqual(messages[1].companyContext,context);assert.deepEqual(baseline,governed);
});
test('accepted worker correlation persists before malformed plan rejection',async()=>{
 let accepted:string|undefined;
 const transport:PlannerTransport={async health(){return {};},async create(){return {session:{state:{sessionId:'accepted-worker'}},response:{async result(){return {data:{goal:'Bad plan',steps:[{toolId:'unrestricted_shell',purpose:'Invalid',policyReferences:[],memoryReferences:[]}]}};}}};}};
 await assert.rejects(planWithEve('Investigate','customer-logs','production',null,{runId:'bad-plan-run',transport,onSession:async id=>{accepted=id;}}));assert.equal(accepted,'accepted-worker');
});
test('model citations must identify supplied policies or episodes, with unsupported values retained for audit',async()=>{
 const transport:PlannerTransport={async health(){return {};},async create(){return {session:{state:{sessionId:'citation-worker'}},response:{async result(){return {data:{goal:'Inspect logs',steps:[{toolId:'internal_logs.search',purpose:'Inspect logs',policyReferences:['DATA-18','acme-demo:3:DATA-18','invented-rule'],memoryReferences:['episode-1','own-run-id']}]}};}}};}};
 const baseline=await planWithEve('Inspect','customer-logs','production',null,{runId:'own-run-id',transport});
 assert.deepEqual(baseline.steps[0].policyReferences,[]);assert.deepEqual(baseline.steps[0].memoryReferences,[]);assert.equal(baseline.unverifiedReferences?.length,5);
 const context={currentRules:[{id:'DATA-18'}],semanticMemory:[{id:'acme-demo:3:DATA-18',ruleId:'DATA-18'}],episodes:[{id:'episode-1'}]};
 const governed=await planWithEve('Inspect','customer-logs','production',context,{runId:'governed',transport});
 assert.deepEqual(governed.steps[0].policyReferences,['DATA-18','acme-demo:3:DATA-18']);assert.deepEqual(governed.steps[0].memoryReferences,['episode-1']);
 assert.deepEqual(governed.unverifiedReferences,[{stepIndex:0,kind:'policy',reference:'invented-rule'},{stepIndex:0,kind:'memory',reference:'own-run-id'}]);
 assert.equal(governed.steps[0].toolId,'internal_logs.search');
});

test('greetings get a model reply with no supplied tools; mixed greeting and action still plans normally',async()=>{
 const requests:Record<string,any>[]=[];
 const transport:PlannerTransport={async health(){return {};},async create(input){const message=JSON.parse(input.message);requests.push(message);return {session:{state:{sessionId:'reply-worker'}},response:{async result(){return {data:message.availableTools.length?{goal:'Inspect logs',steps:[{toolId:'internal_logs.search',purpose:'Requested log search',policyReferences:[],memoryReferences:[]}]}:{goal:'Greet the user',reply:'Hello! How can I help with your engineering work?',steps:[]}};}}};}};
 for(const task of ['hello','hellow\nhello','Hi there!','thanks']){
  const reply=await planWithEve(task,'customer-logs','production',null,{runId:task,transport});
  assert.equal(reply.reply,'Hello! How can I help with your engineering work?');assert.deepEqual(reply.steps,[]);assert.deepEqual(requests.at(-1)!.availableTools,[]);
 }
 const action=await planWithEve('Hello, use internal_logs.search to investigate checkout errors.','customer-logs','production',null,{runId:'action',transport});
 assert.equal(action.steps[0].toolId,'internal_logs.search');assert.ok(requests.at(-1)!.availableTools.length);
});

test('social tool proposals and empty tool-free replies are rejected before execution',async()=>{
 for(const data of [{goal:'Greet',reply:'Hello',steps:[{toolId:'internal_logs.search',purpose:'Unrequested search',policyReferences:[],memoryReferences:[]}]},{goal:'Reply',steps:[]}]){
  const transport:PlannerTransport={async health(){return {};},async create(){return {session:{state:{sessionId:'invalid-reply'}},response:{async result(){return {data};}}};}};
  await assert.rejects(planWithEve('hello','customer-logs','production',null,{runId:'invalid',transport}));
 }
});

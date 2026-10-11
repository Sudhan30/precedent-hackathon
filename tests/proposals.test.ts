import {test} from 'node:test';import assert from 'node:assert/strict';
import {openStore} from '../apps/server/store.js';import {Precedent} from '../apps/server/service.js';import {ExecutionGateway} from '../packages/execution/index.js';
async function evidence(service:Precedent,gateway:ExecutionGateway,id:string){const session=service.session();const action=service.action(session.id,'example_connector.analyze','sandbox-logs','sandbox');assert.equal((await gateway.execute(action,id)).status,'PENDING');service.approve(id,30);assert.equal((await gateway.execute(action,id+':resume')).status,'SUCCEEDED');return action;}
test('reviewed approval-derived proposal changes only its exact sandbox scope',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const gateway=new ExecutionGateway(service,{async execute(){return {result:'synthetic success'};},async receipts(){return [];}});
 service.publish({...service.policy(),sandboxAllowed:false,sandboxApprovalRequired:true});
 const action=await evidence(service,gateway,'a');assert.equal(service.analyzeProposals().length,0);await evidence(service,gateway,'b');
 const [draft]=service.analyzeProposals();assert.equal(draft.count,2);assert.equal(service.analyzeProposals()[0].id,draft.id);
 assert.equal((await gateway.execute(action,'before')).status,'PENDING');
 service.publishProposal(draft.id,draft.baseVersion);assert.equal((await gateway.execute(action,'after')).status,'SUCCEEDED');
 assert.equal((await gateway.execute({...action,environment:'production'},'production')).status,'BLOCKED');
 assert.equal((await gateway.execute({...action,resourceId:'customer-logs'},'restricted')).status,'BLOCKED');
 assert.equal((await gateway.execute({...action,toolId:'demo_export.send'},'different-tool')).status,'PENDING');
 service.incident('example_connector.analyze');assert.equal((await gateway.execute(action,'incident')).status,'BLOCKED');store.close();
});
test('stale and incident-linked evidence cannot publish a permission proposal',async()=>{
 const store=openStore(':memory:');const service=new Precedent(store);const gateway=new ExecutionGateway(service,{async execute(){return {result:'synthetic success'};},async receipts(){return [];}});service.publish({...service.policy(),sandboxAllowed:false,sandboxApprovalRequired:true});await evidence(service,gateway,'a');await evidence(service,gateway,'b');const [draft]=service.analyzeProposals();service.publish({...service.policy()});assert.throws(()=>service.publishProposal(draft.id,draft.baseVersion));service.incident('example_connector.analyze');assert.equal(service.analyzeProposals().length,0);store.close();
});

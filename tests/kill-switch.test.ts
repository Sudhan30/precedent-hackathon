import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/api.js';
import {Precedent} from '../apps/server/service.js';
import {openStore} from '../apps/server/store.js';
import {ExecutionGateway} from '../packages/execution/index.js';

async function harness(){
 const store=openStore(':memory:');const service=new Precedent(store);
 // Independent downstream receipt list, like the connector's own store.
 const downstream:any[]=[];const gateway=new ExecutionGateway(service,{async execute(action,id,baseline){downstream.push({executionId:id,input:{toolId:action.toolId,baseline}});return {result:'synthetic analysis',receiptId:id};},async receipts(){return [...downstream];}});
 const server=createApp(service,gateway).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api`;
 const call=async(path:string,body?:unknown,token?:string)=>{const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json() as any};};
 const employee=(await call('/login',{role:'employee'})).data.token,admin=(await call('/login',{role:'admin'})).data.token;
 const compare=(scenario:string,target='both')=>call('/comparison',{task:'Analyze logs with the connector',scenario,planner:'fixture',target},employee);
 return {store,service,downstream,call,employee,admin,compare,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}};
}
const tool='example_connector.analyze';

test('blast radius separates exposure, blocked attempts, unused access and the ungoverned baseline without writing anything',async()=>{
 const h=await harness();try{
  await h.compare('sandbox');// governed executes in sandbox; baseline bypasses governance
  await h.compare('investigation','governed');// restricted customer data: blocked before the tool
  await h.call('/sessions',{},h.employee);// configured access, never used
  const before={events:h.store.all('event').length,version:h.service.policy().version,receipts:h.downstream.length};
  assert.equal((await h.call('/incidents/preview?toolId='+tool,undefined,h.employee)).status,403);
  const preview=(await h.call('/incidents/preview?toolId='+tool,undefined,h.admin)).data;
  assert.equal(preview.key,'example_connector.analyze@2.4');assert.equal(preview.quarantined,false);
  assert.deepEqual([preview.summary.exposedAgents,preview.summary.exposedCalls,preview.summary.blockedAttempts,preview.summary.baselineCalls],[1,1,1,1]);
  assert.ok(preview.summary.neverUsedAgents>=1);assert.equal(preview.summary.restrictedDataExposed,false);assert.deepEqual(preview.summary.resourcesExposed,['sandbox-logs']);
  assert.equal(preview.receipts.count,2);assert.equal(preview.receipts.source,'independent connector receipt store');
  assert.deepEqual({events:h.store.all('event').length,version:h.service.policy().version,receipts:h.downstream.length},before,'preview is read-only');
 }finally{await h.close();}
});

test('one-click quarantine blocks the next call and the connector receipt count does not move',async()=>{
 const h=await harness();try{
  await h.compare('sandbox','governed');
  assert.equal((await h.call('/incidents/test-call',{toolId:tool},h.employee)).status,403);
  const allowed=(await h.call('/incidents/test-call',{toolId:tool},h.admin)).data;
  assert.equal(allowed.execution.status,'SUCCEEDED');assert.equal(allowed.receipts.after,allowed.receipts.before+1);
  const incident=(await h.call('/incidents',{toolId:tool},h.admin)).data;
  assert.equal(incident.receipts.before,incident.receipts.after);assert.ok(h.service.policy().quarantined.includes('example_connector.analyze@2.4'));
  const blocked=(await h.call('/incidents/test-call',{toolId:tool},h.admin)).data;
  assert.equal(blocked.execution.status,'BLOCKED');assert.equal(blocked.execution.decision.ruleId,'INCIDENT-01');
  assert.equal(blocked.receipts.after,blocked.receipts.before,'the tool never received the blocked call');
  const preview=(await h.call('/incidents/preview?toolId='+tool,undefined,h.admin)).data;assert.equal(preview.quarantined,true);assert.equal(preview.summary.blockedAttempts,1);
 }finally{await h.close();}
});

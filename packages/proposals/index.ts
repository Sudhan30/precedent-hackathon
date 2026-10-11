import {createHash} from 'node:crypto';
import {registry,type SandboxAllowance,type McpProposalScope,type PolicyProposal} from '../contracts/index.js';
import {mcpKey} from '../mcp/contracts.js';
import type {Precedent} from '../../apps/server/service.js';
export type Proposal=PolicyProposal;
function eligible(service:Precedent){
 const policy=service.policy();
 return service.store.all('execution').filter(e=>{
  const a=e.action,tool=registry[a.toolId as keyof typeof registry];
  const session=service.store.get('session',a.sessionId);if(!session||!service.sessionIsCurrent(session))return false;
  if(e.baseline||e.status!=='SUCCEEDED'||!e.receiptId||!e.decision.grantId||!tool?.external||a.actorId!=='engineer-1'||a.resourceId!=='sandbox-logs'||a.environment!=='sandbox')return false;
  const grant=service.store.get('grant',e.decision.grantId);const receipt=service.store.get('receipt',e.receiptId);
  if(!grant?.consumed||grant.revoked||grant.toolVersion!==tool.version||receipt?.executionId!==e.id||receipt.toolVersion!==tool.version)return false;
  if(policy.quarantined.includes(`${a.toolId}@${tool.version}`)||service.store.all('incident').some(i=>i.toolId===a.toolId&&(i.demoRunId??service.demo().legacyDemoRunId)===service.demo().demoRunId))return false;
  return true;
 });
}
// Repeated one-use approvals for the same reviewed endpoint are evidence that a
// human keeps making the same decision. Only governed, administrator-reviewed,
// consumed approvals whose recorded discovery actually CONNECTED qualify.
export const MCP_PROPOSAL_MIN_APPROVALS=3;
function eligibleMcp(service:Precedent){
 return service.store.all('mcp_request').filter(r=>{
  if(r.demoRunId!==service.demo().demoRunId||r.scope!=='once'||r.status!=='CONSUMED'||!r.reviewedBy||!r.endpoint)return false;
  const run=service.store.get('run',r.runId),session=service.store.get('session',r.sessionId);
  return Boolean(run&&session&&service.sessionIsCurrent(session)&&run.mode==='governed'&&run.mcpResult?.status==='CONNECTED'&&run.mcpResult?.endpoint===r.endpoint);
 });
}
export function analyzeMcpProposals(service:Precedent){
 const policy=service.policy();const groups=new Map<string,any[]>();
 for(const request of eligibleMcp(service)){const key=mcpKey(request.name)+'\0'+request.endpoint;const cohort=groups.get(key)??[];cohort.push(request);groups.set(key,cohort);}
 const drafts:Proposal[]=[];
 for(const records of groups.values()){
  const sessions=new Set(records.map(r=>r.sessionId)).size;
  if(records.length<MCP_PROPOSAL_MIN_APPROVALS||sessions<2)continue;
  const first=records[0];const scope:McpProposalScope={kind:'mcp',key:mcpKey(first.name),name:first.name,endpoint:first.endpoint,allowed:true};
  if(policy.mcpConnections?.some(item=>item.key===scope.key))continue;
  const evidenceIds=records.map(r=>r.id).sort();const id=createHash('sha256').update(JSON.stringify({version:policy.version,scope,evidenceIds})).digest('hex').slice(0,24);
  const previous=service.store.get<Proposal>('proposal',id);if(previous){drafts.push(previous);continue;}
  const reviewers=new Set(records.map(r=>r.reviewedBy)).size;
  const draft:Proposal={id,demoRunId:service.demo().demoRunId,status:'DRAFT',baseVersion:policy.version,scope,evidenceIds,count:records.length,at:service.clock(),description:`Administrators approved ${first.name} one request at a time ${records.length} times across ${sessions} sessions (${reviewers} reviewer${reviewers===1?'':'s'}), and every connection succeeded. Precedent drafted a company rule that allows only this exact endpoint.`};
  service.record('proposal',draft);service.emit('proposal.created',{proposalId:id,evidenceIds,scope,source:'mcp-approvals'});drafts.push(draft);
 }return drafts;
}
export function analyzeProposals(service:Precedent){return [...analyzeToolProposals(service),...analyzeMcpProposals(service)];}
function analyzeToolProposals(service:Precedent){
 const policy=service.policy();if(policy.sandboxAllowed)return [];
 const groups=new Map<string,any[]>();for(const execution of eligible(service)){const key=execution.action.toolId;const cohort=groups.get(key)??[];cohort.push(execution);groups.set(key,cohort);}
 const drafts:Proposal[]=[];
 for(const [toolId,records]of groups){
  if(records.length<2||new Set(records.map(e=>e.action.sessionId)).size<2)continue;
  const scope:SandboxAllowance={actorId:'engineer-1',toolId:toolId as SandboxAllowance['toolId'],toolVersion:registry[toolId as keyof typeof registry].version,resourceId:'sandbox-logs',environment:'sandbox'};
  if(policy.sandboxAllowances?.some(r=>JSON.stringify(r)===JSON.stringify(scope)))continue;
  const evidenceIds=records.map(e=>e.id).sort();const id=createHash('sha256').update(JSON.stringify({version:policy.version,scope,evidenceIds})).digest('hex').slice(0,24);
  const previous=service.store.get<Proposal>('proposal',id);if(previous){drafts.push(previous);continue;}
  const draft:Proposal={id,demoRunId:service.demo().demoRunId,status:'DRAFT',baseVersion:policy.version,scope,evidenceIds,count:records.length,at:service.clock(),description:`${records.length} successful scoped approvals across ${new Set(records.map(e=>e.action.sessionId)).size} sessions support permitting ${toolId} v${scope.toolVersion} for this engineer's synthetic sandbox.`};
  service.record('proposal',draft);service.emit('proposal.created',{proposalId:id,evidenceIds,scope});drafts.push(draft);
 }return drafts;
}
export function publishProposal(service:Precedent,id:string,expectedVersion:number){
 const proposal=service.store.get<Proposal>('proposal',id);if(!proposal||proposal.status!=='DRAFT')throw new Error('No draft proposal');
 if(expectedVersion!==service.policy().version||proposal.baseVersion!==expectedVersion)throw Object.assign(new Error('Policy changed; analyze fresh evidence before publication'),{status:409});
 // Scope comes only from the constrained generator, never from the publish input.
 const scope=proposal.scope;let policy;
 if('kind' in scope){
  const ids=new Set(eligibleMcp(service).map(r=>r.id));if(proposal.count<MCP_PROPOSAL_MIN_APPROVALS||proposal.evidenceIds.some(id=>!ids.has(id)))throw new Error('Proposal evidence is no longer eligible');
  const connections=service.policy().mcpConnections??[];if(connections.some(item=>item.key===scope.key))throw Object.assign(new Error('MCP configuration changed; analyze fresh evidence'),{status:409});
  policy=service.publish({...service.policy(),mcpConnections:[...connections,{key:scope.key,name:scope.name,endpoint:scope.endpoint,allowed:true}]},true,'Reviewed self-written guardrail '+proposal.id+': '+proposal.description);
 }else{
  const ids=new Set(eligible(service).map(e=>e.id));if(proposal.count<2||proposal.evidenceIds.some(id=>!ids.has(id)))throw new Error('Proposal evidence is no longer eligible');
  if(scope.actorId!=='engineer-1'||scope.resourceId!=='sandbox-logs'||scope.environment!=='sandbox'||registry[scope.toolId]?.version!==scope.toolVersion)throw new Error('Invalid proposal scope');
  policy=service.publish({...service.policy(),sandboxAllowances:[...(service.policy().sandboxAllowances??[]),scope]},true,'Reviewed proposal '+proposal.id+': '+proposal.description);
 }
 const published:Proposal={...proposal,status:'PUBLISHED',publishedVersion:policy.version};service.record('proposal',published);service.emit('proposal.published',{proposalId:id,version:policy.version,evidenceIds:proposal.evidenceIds,reviewer:service.reviewerId});return published;
}

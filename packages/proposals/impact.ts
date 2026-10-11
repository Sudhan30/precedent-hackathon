import type {Precedent} from '../../apps/server/service.js';
import {evaluate} from '../policy-engine/index.js';
import {mcpConnectionDecision} from '../mcp/decision.js';
import {mcpDecision} from '../mcp/index.js';
import type {Action,Policy,PolicyProposal} from '../contracts/index.js';

type Verdict='ALLOW'|'BLOCK'|'REQUIRE_APPROVAL';
const ruleLabels:Record<string,string>={
 'DATA-18':'Restricted customer data to external tools','INCIDENT-01':'Quarantined tool versions','ACCESS-07':'Staging database without a current approval',
 'MCP-01':'Unreviewed or blocked MCP servers','MCP-02':'Administrator-disabled tools','SANDBOX-APPROVAL':'Sandbox exports that need approval',
 'DEFAULT-DENY':'Actions with no matching allow rule','IDENTITY-01':'Unverified actors or resources','POLICY-01':'Unverifiable policy'
};
export function draftPolicy(policy:Policy,proposal:PolicyProposal):Policy{
 const scope=proposal.scope;
 return 'kind' in scope?{...policy,mcpConnections:[...(policy.mcpConnections??[]),{key:scope.key,name:scope.name,endpoint:scope.endpoint,allowed:true}]}:{...policy,sandboxAllowances:[...(policy.sandboxAllowances??[]),scope]};
}
const probe=(toolId:Action['toolId'],resourceId:Action['resourceId'],environment:Action['environment']):Action=>({actorId:'engineer-1',agentId:'safety-probe',sessionId:'safety-probe',toolId,resourceId,environment});
// Counterfactual and non-executing: every recorded governed decision is evaluated
// under the current policy and under the draft, with its original grants and time.
// Comparing current vs draft isolates the draft's own effect from older policy changes.
export function impactPreview(service:Precedent,proposalId:string){
 const proposal=service.store.get<PolicyProposal>('proposal',proposalId);if(!proposal)throw Object.assign(new Error('Unknown proposal'),{status:404});
 const current=service.policy(),draft=draftPolicy(current,proposal);
 const rows:{id:string;kind:'tool'|'mcp';label:string;from:Verdict;to:Verdict;ruleId:string}[]=[];
 for(const e of service.store.all('execution')){
  if(e.baseline||!e.action?.toolId)continue;
  const before=evaluate(e.action,current,e.grants??[],e.at),after=evaluate(e.action,draft,e.grants??[],e.at);
  rows.push({id:e.id,kind:'tool',label:`${e.action.toolId} · ${e.action.resourceId} · ${e.action.environment}`,from:before.verdict,to:after.verdict,ruleId:after.ruleId});
 }
 for(const run of service.store.all('run')){
  if(run.mode!=='governed'||!run.mcpResult)continue;
  const name=run.mcpResult.name??'Tenable',endpoint=run.mcpResult.endpoint||null;
  const decide=(policy:Policy)=>run.scenario==='tenable'?mcpDecision(policy,'governed'):mcpConnectionDecision(policy,name,endpoint);
  const before=decide(current),after=decide(draft);
  rows.push({id:run.id,kind:'mcp',label:`Connect ${name} MCP`,from:before.verdict,to:after.verdict,ruleId:after.ruleId});
 }
 const changed=rows.filter(r=>r.from!==r.to);
 const stillBlocked=Object.entries(Object.groupBy(rows.filter(r=>r.to!=='ALLOW'),r=>r.ruleId)).map(([ruleId,items])=>({ruleId,label:ruleLabels[ruleId]??ruleId,count:items!.length})).sort((a,b)=>b.count-a.count);
 const quarantinedTool=current.quarantined[0]?.split('@')[0] as Action['toolId']|undefined;
 const safetyChecks=[
  {label:'Customer data sent to an external tool',expected:'BLOCK',verdict:evaluate(probe('example_connector.analyze','customer-logs','production'),draft,[],service.clock()).verdict},
  {label:'Production staging database without approval',expected:'REQUIRE_APPROVAL',verdict:evaluate(probe('staging_db.read','staging-records','production'),draft,[],service.clock()).verdict},
  {label:'A different, unreviewed MCP server',expected:'REQUIRE_APPROVAL',verdict:mcpConnectionDecision(draft,'Unreviewed Server','https://unreviewed.example.com/mcp').verdict},
  ...(quarantinedTool?[{label:`Quarantined ${current.quarantined[0]} still blocked`,expected:'BLOCK',verdict:evaluate(probe(quarantinedTool,'sandbox-logs','sandbox'),draft,[],service.clock()).verdict}]:[])
 ].map(check=>({...check,pass:check.verdict!=='ALLOW'}));
 return {proposalId,baseVersion:proposal.baseVersion,currentVersion:current.version,evaluatedAt:service.clock(),total:rows.length,toolDecisions:rows.filter(r=>r.kind==='tool').length,mcpDecisions:rows.filter(r=>r.kind==='mcp').length,
  changed:changed.slice(0,50),changedCount:changed.length,newlyRestricted:changed.filter(r=>r.from==='ALLOW').length,stillBlocked,safetyChecks,sideEffects:0,mode:'counterfactual: current policy vs draft, original grants and evaluation time'};
}

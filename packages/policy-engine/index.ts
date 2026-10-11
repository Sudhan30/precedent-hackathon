import {registry,policyDecisionSchema,grantSchema,type Action,type Policy,type Grant,type Decision} from '../contracts/index.js';
import {classificationOf} from '../warehouse/index.js';
// A grant is bound to the exact table and department as well as the session and tool.
export function scopeMatches(a:Action,b:Action) {return ['actorId','agentId','sessionId','toolId','resourceId','environment','target','department'].every(k=>a[k as keyof Action]===b[k as keyof Action]);}
export function evaluate(action:Action, policy:Policy, grants:Grant[]=[], now=Date.now()):Decision {
 const result=(verdict:Decision['verdict'],reason:string,ruleId:string,extra:Partial<Decision>={}):Decision=>policyDecisionSchema.parse({verdict,reason,ruleId,policyVersion:Number.isSafeInteger(policy?.version)&&policy.version>=0?policy.version:0,...extra});
 if(!policy||!Number.isSafeInteger(policy.version)||policy.version<1||typeof policy.sandboxAllowed!=='boolean'||!Array.isArray(policy.quarantined)||policy.quarantined.some(k=>typeof k!=='string'))return result('BLOCK','Authoritative policy could not be verified','POLICY-01');
 if(policy.sandboxApprovalRequired!==undefined&&typeof policy.sandboxApprovalRequired!=='boolean'||policy.sandboxAllowances!==undefined&&(!Array.isArray(policy.sandboxAllowances)||policy.sandboxAllowances.some(r=>!r||r.actorId!=='engineer-1'||r.resourceId!=='sandbox-logs'||r.environment!=='sandbox'||!Object.hasOwn(registry,r.toolId)||typeof r.toolVersion!=='string')))return result('BLOCK','Authoritative policy could not be verified','POLICY-01');
 if(policy.deniedTools!==undefined&&(!Array.isArray(policy.deniedTools)||policy.deniedTools.some(id=>!Object.hasOwn(registry,id))))return result('BLOCK','Authoritative policy could not be verified','POLICY-01');
 if(policy.deniedTools?.includes(action.toolId))return result('BLOCK','Administrator disabled this tool','MCP-02');
 const tool=Object.hasOwn(registry,action.toolId)?registry[action.toolId]:undefined;
 if (!tool || !tool.resources.includes(action.resourceId) || action.actorId!=='engineer-1' || !action.sessionId || !action.agentId || !['production','sandbox'].includes(action.environment)) return result('BLOCK','Unverified actor or incompatible resource','IDENTITY-01');
 if (policy.quarantined.includes(`${action.toolId}@${tool.version}`)) return result('BLOCK','This tool version is quarantined','INCIDENT-01');
 if (tool.external && action.resourceId==='customer-logs') return result('BLOCK','Restricted customer logs cannot leave the internal boundary','DATA-18',{alternative:'internal_logs.search'});
 const grant=grants.find(g=>grantSchema.safeParse(g).success&&g&&g.action&&!g.consumed&&!g.revoked&&g.toolVersion===tool.version&&g.expiresAt>now&&g.policyVersion===policy.version&&scopeMatches(g.action,action));
 if(action.toolId==='warehouse.query'){
  // Classification comes from the server-controlled catalog, never from the agent.
  const classification=classificationOf(action.target);
  if(!classification)return result('BLOCK','Unknown or missing warehouse table','DATA-30');
  if(classification==='finance-restricted'&&action.department!=='finance')return grant?result('ALLOW','Valid one-time approval for a finance-restricted table','DATA-31',{grantId:grant.id}):result('REQUIRE_APPROVAL','Finance-restricted tables need the finance department or a one-time approval','DATA-31');
  return result('ALLOW','Internal warehouse query is permitted','INTERNAL-02');
 }
 if (action.toolId==='staging_db.read') {
  return grant?result('ALLOW','Valid scoped, one-use approval','ACCESS-07',{grantId:grant.id}):result('REQUIRE_APPROVAL','Staging access needs a current scoped approval','ACCESS-07');
 }
 if (!tool.external) return result('ALLOW','Internal log search is permitted','INTERNAL-02');
 if(action.environment==='sandbox'&&action.resourceId==='sandbox-logs'&&policy.sandboxAllowances?.some(r=>r.actorId===action.actorId&&r.toolId===action.toolId&&r.toolVersion===tool.version))return result('ALLOW','Reviewed scoped sandbox policy permits this action','SANDBOX-LEARNED');
 if(action.environment==='sandbox'&&policy.sandboxAllowed) return result('ALLOW','Synthetic sandbox export is permitted','SANDBOX-04');
 if(action.environment==='sandbox'&&action.resourceId==='sandbox-logs'&&policy.sandboxApprovalRequired)return grant?result('ALLOW','Valid scoped, one-use sandbox approval','SANDBOX-APPROVAL',{grantId:grant.id}):result('REQUIRE_APPROVAL','Synthetic sandbox analysis requires a scoped approval','SANDBOX-APPROVAL');
 return result('BLOCK','No matching allow rule','DEFAULT-DENY');
}

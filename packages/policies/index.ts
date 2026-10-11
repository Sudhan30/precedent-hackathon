import {z} from 'zod';
import {policySchema,policyRuleSchema} from '../contracts/index.js';
export {policySchema} from '../contracts/index.js';
import type {Policy} from '../contracts/index.js';
export const policyChangeSchema=z.object({expectedVersion:z.number().int().positive(),sandboxAllowed:z.boolean(),sandboxApprovalRequired:z.boolean().optional(),reason:z.string().trim().min(1).max(1000).default('Administrator sandbox settings update')}).strict();
export function previewPolicyChange(policy:Policy,raw:unknown){
 const current=policySchema.parse(policy);
 const input=policyChangeSchema.parse(raw);
 if(input.expectedVersion!==current.version)throw Object.assign(new Error('Policy changed; refresh before reviewing or publishing'),{status:409});
 const proposed={...current,sandboxAllowed:input.sandboxAllowed,sandboxApprovalRequired:input.sandboxApprovalRequired??current.sandboxApprovalRequired??false};
 const fields=['sandboxAllowed','sandboxApprovalRequired'] as const;
 const differences=fields.filter(field=>Boolean(current[field])!==Boolean(proposed[field])).map(field=>({field,before:Boolean(current[field]),after:Boolean(proposed[field])}));
 return {input:{...input,sandboxApprovalRequired:proposed.sandboxApprovalRequired},baseVersion:current.version,differences,beforeRules:describeRules({...current,sandboxApprovalRequired:current.sandboxApprovalRequired??false}),afterRules:describeRules(proposed)};
}
export type PolicyChangePreview=ReturnType<typeof previewPolicyChange>;
export const describeRules=(policy:z.infer<typeof policySchema>)=>[
 {id:'MCP-01',description:`Tenable documentation MCP connection is ${policy.tenableAllowed?'allowed':'blocked'}. Disabled tools: ${(policy.deniedTools??[]).join(', ')||'none'}. Connection permission does not authorize tool execution.${policy.mcpConnections?.length?' Reviewed MCP endpoints: '+policy.mcpConnections.map(item=>item.name+' ('+(item.allowed?'allowed':'blocked')+')').join(', ')+'.':''}`},
 {id:'DATA-18',description:'Restricted customer logs cannot leave through external tools; use internal_logs.search.'},
 {id:'INTERNAL-02',description:'The authenticated demo engineer may search customer and sandbox logs internally.'},
 {id:'ACCESS-07',description:'Staging access needs a current, scoped, one-use approval. Historical approvals grant no permission.'},
 {id:'SANDBOX-04',description:`Synthetic sandbox export is ${policy.sandboxAllowed?'allowed':policy.sandboxApprovalRequired?'subject to scoped approval':'disabled'}. Reviewed scope allowances: ${(policy.sandboxAllowances??[]).map(r=>r.toolId+'@'+r.toolVersion+' for '+r.actorId).join(', ')||'none'}.`},
 {id:'INCIDENT-01',description:`Quarantined tool versions override approvals: ${policy.quarantined.join(', ')||'none'}.`}
].map(rule=>policyRuleSchema.parse(rule));
export function policyDocuments(policy:z.infer<typeof policySchema>,tenantId='acme-demo'){
 return describeRules(policy).map(rule=>({id:tenantId+':'+policy.version+':'+rule.id,tenantId,visibleRoles:['employee','admin'],policyVersion:policy.version,ruleId:rule.id,summary:rule.description}));
}

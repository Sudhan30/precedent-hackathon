import {z} from 'zod';
import {mcpAccessSchema,mcpRequestSchema,mcpNameSchema,endpointSchema,mcpKey} from '../mcp/contracts.js';
import {departments,tableNamePattern} from '../warehouse/index.js';
export const departmentSchema=z.enum(departments);
export const toolIds = ['internal_logs.search','example_connector.analyze','staging_db.read','demo_export.send','metrics.query','deploy_history.read','warehouse.query'] as const;
export type ToolId = typeof toolIds[number];
export const registry: Record<ToolId,{version:string; external:boolean; resources:Action['resourceId'][]}> = {
 'internal_logs.search':{version:'1.0',external:false,resources:['customer-logs','sandbox-logs']},
 'example_connector.analyze':{version:'2.4',external:true,resources:['customer-logs','sandbox-logs']},
 'staging_db.read':{version:'1.0',external:false,resources:['staging-records']},
 'demo_export.send':{version:'2.4',external:true,resources:['customer-logs','sandbox-logs']},
 // Internal, read-only synthetic investigation tools for multi-step procedures.
 'metrics.query':{version:'1.0',external:false,resources:['customer-logs','sandbox-logs']},
 'deploy_history.read':{version:'1.0',external:false,resources:['customer-logs','sandbox-logs']},
 // Synthetic BigQuery-style warehouse; the agent names a table, the catalog decides classification.
 'warehouse.query':{version:'1.0',external:false,resources:['warehouse']}
};

const text=z.string().min(1);
const version=z.number().int().positive();
const at=z.number().finite().nonnegative();
export const verdictSchema=z.enum(['ALLOW','BLOCK','REQUIRE_APPROVAL']);
// department is copied from the server-side session, never from client input; target names a warehouse table.
export const actionRequestSchema=z.object({actorId:text,agentId:text,sessionId:text,toolId:z.enum(toolIds),resourceId:z.enum(['customer-logs','sandbox-logs','staging-records','warehouse']),environment:z.enum(['production','sandbox']),target:z.string().max(120).regex(tableNamePattern).optional(),department:departmentSchema.optional()}).strict();
export const actionInputSchema=actionRequestSchema.omit({actorId:true,agentId:true,department:true}).extend({sessionId:z.string().uuid(),executionId:z.string().min(1).max(100)}).strict();
export const sandboxAllowanceSchema=z.object({actorId:z.literal('engineer-1'),toolId:z.enum(toolIds),toolVersion:text,resourceId:z.literal('sandbox-logs'),environment:z.literal('sandbox')}).strict();
// Learned MCP scope: one exact reviewed endpoint, derived from repeated one-use approvals.
export const mcpProposalScopeSchema=z.object({kind:z.literal('mcp'),key:text,name:mcpNameSchema,endpoint:endpointSchema,allowed:z.literal(true)}).strict().refine(value=>value.key===mcpKey(value.name),'MCP key must match its reviewed name');
export const proposalScopeSchema=z.union([sandboxAllowanceSchema,mcpProposalScopeSchema]);
export const policyRuleSchema=z.object({id:text,description:text}).loose();
export const policySchema=z.object({version,sandboxAllowed:z.boolean(),quarantined:z.array(text),sandboxApprovalRequired:z.boolean().optional(),tenableAllowed:z.boolean().optional(),deniedTools:z.array(z.enum(toolIds)).optional(),sandboxAllowances:z.array(sandboxAllowanceSchema).optional(),mcpConnections:z.array(mcpAccessSchema).refine(items=>new Set(items.map(item=>item.key)).size===items.length,'Reviewed MCP keys must be unique').optional()}).loose();
export const policyVersionSchema=policySchema.extend({id:text,rules:z.array(policyRuleSchema).optional(),reason:text.optional(),publishedAt:at.optional(),publishedBy:text.optional()});
export const policyDecisionSchema=z.object({verdict:verdictSchema,policyVersion:z.number().int().nonnegative(),reason:text,ruleId:text,alternative:z.enum(toolIds).optional(),grantId:text.optional()}).loose().refine(value=>value.verdict!=='ALLOW'||value.policyVersion>0,{message:'An allow decision requires a verified policy version'});
export const grantSchema=z.object({id:text,action:actionRequestSchema,policyVersion:version,toolVersion:text,expiresAt:at,consumed:z.boolean(),revoked:z.boolean()}).loose();
// Older audit grants can be displayed, but grantSchema is mandatory for authorization.
export const grantHistorySchema=grantSchema.partial({toolVersion:true,revoked:true});
export const approvalSchema=z.object({id:text,action:actionRequestSchema,policyVersion:version,status:z.enum(['PENDING','APPROVED','DENIED']),at,reviewedAt:at.optional(),reviewedBy:text.optional()}).loose();
export const runEventSchema=z.object({id:text,type:text,at,demoRunId:text.optional(),sessionId:text.optional(),runId:text.optional(),executionId:text.optional(),sequence:z.number().int().positive().optional(),decision:policyDecisionSchema.optional(),action:actionRequestSchema.optional()}).loose();
export const episodeSchema=z.object({id:text,sessionId:text,toolId:z.enum(toolIds),resourceId:actionRequestSchema.shape.resourceId,policyVersion:version,at,decision:verdictSchema,summary:text,evidenceId:text,tenantId:text.optional(),visibleRoles:z.array(z.enum(['employee','admin'])).optional(),demoRunId:text.optional(),kind:z.literal('run-outcome').optional(),sourceRunId:text.optional(),outcomeStatus:z.enum(['FINISHED','WAITING','UNKNOWN']).optional(),evidenceIds:z.array(text).optional(),supportingEventIds:z.array(text).optional(),policyVersions:z.array(version).optional(),alternative:z.enum(toolIds).nullable().optional(),supersededBy:text.optional()}).loose();
export const incidentSchema=z.object({id:text,toolId:z.enum(toolIds),toolVersion:text,version,at,source:z.literal('explicit-demo-injection'),reportedBy:text,executedSessions:z.array(text),baselineReceipts:z.number().int().nonnegative(),blockedAttempts:z.number().int().nonnegative(),unknownOutcomes:z.number().int().nonnegative(),evidenceIds:z.array(text),demoRunId:text.optional()}).loose();
export const policyProposalSchema=z.object({id:text,demoRunId:text.optional(),status:z.enum(['DRAFT','PUBLISHED']),baseVersion:version,scope:proposalScopeSchema,evidenceIds:z.array(text).min(2),count:z.number().int().min(2),description:text,at,publishedVersion:version.optional()}).loose().superRefine((value,context)=>{if(value.count!==value.evidenceIds.length||new Set(value.evidenceIds).size!==value.evidenceIds.length)context.addIssue({code:'custom',message:'Proposal counts must match unique evidence'});if(value.status==='PUBLISHED'&&!value.publishedVersion)context.addIssue({code:'custom',message:'Published proposal needs its policy version'});});
export const snapshotRecordsSchema=z.object({policy:policySchema,policies:z.array(policyVersionSchema),approvals:z.array(approvalSchema),grants:z.array(grantHistorySchema),episodes:z.array(episodeSchema),incidents:z.array(incidentSchema),policyProposals:z.array(policyProposalSchema),events:z.array(runEventSchema),mcpRequests:z.array(mcpRequestSchema).default([])}).loose();
const storedSchemas:Record<string,z.ZodType>={mcp_request:mcpRequestSchema,policy:policySchema,policy_version:policyVersionSchema,event:runEventSchema,approval:approvalSchema,grant:grantSchema,episode:episodeSchema,incident:incidentSchema,proposal:policyProposalSchema};
// New domain writes are checked; historical reads remain intact for inspection.
export function validateStoredRecord(kind:string,value:{id:string;[key:string]:unknown}){return storedSchemas[kind]?storedSchemas[kind].parse(value) as typeof value:value;}
export type ActionRequest=z.infer<typeof actionRequestSchema>;
export type Action=ActionRequest;
export type Verdict=z.infer<typeof verdictSchema>;
export type PolicyRule=z.infer<typeof policyRuleSchema>;
export type PolicyDecision=z.infer<typeof policyDecisionSchema>;
export type Decision=PolicyDecision;
export type Policy=Pick<z.infer<typeof policySchema>,'version'|'sandboxAllowed'|'quarantined'|'sandboxApprovalRequired'|'sandboxAllowances'|'tenableAllowed'|'deniedTools'|'mcpConnections'>;
export type SandboxAllowance=z.infer<typeof sandboxAllowanceSchema>;
export type McpProposalScope=z.infer<typeof mcpProposalScopeSchema>;
export type Grant=z.infer<typeof grantSchema>;
export type Approval=z.infer<typeof approvalSchema>;
export type RunEvent=z.infer<typeof runEventSchema>;
export type Episode=z.infer<typeof episodeSchema>;
export type Incident=z.infer<typeof incidentSchema>;
export type PolicyProposal=z.infer<typeof policyProposalSchema>;
export type SnapshotRecords=z.infer<typeof snapshotRecordsSchema>;

export const snapshotResponseSchema=snapshotRecordsSchema.extend({viewer:z.object({role:z.enum(['employee','admin']),userId:z.string().nullable(),tenantId:text}).loose(),demo:z.object({id:z.literal('demo'),demoRunId:text,legacyDemoRunId:text,startedAt:at}).loose()});
export type SnapshotResponse=z.infer<typeof snapshotResponseSchema>;

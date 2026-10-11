import {z} from 'zod';

export const mcpNameSchema=z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._-]*$/);
export const mcpKey=(name:string)=>name.toLowerCase().replace(/[ ._-]+/g,'-').replace(/-mcp$/,'');
export const endpointSchema=z.string().trim().max(500).transform((value,ctx)=>{
 try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443')throw new Error();
 const host=url.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.')||/^\d+(\.\d+){3}$/.test(host)||host.includes(':'))throw new Error();return url.href;
 }catch{ctx.addIssue({code:'custom',message:'Use a public HTTPS MCP endpoint without credentials, query parameters or custom ports.'});return z.NEVER;}
});
export const mcpAccessSchema=z.object({key:z.string().min(1).max(80),name:mcpNameSchema,endpoint:endpointSchema,allowed:z.boolean()}).strict().refine(value=>value.key===mcpKey(value.name),'MCP key must match its reviewed name');
export const mcpRequestSchema=z.object({id:z.string().uuid(),runId:z.string().uuid(),sessionId:z.string().uuid(),demoRunId:z.string().uuid(),tenantId:z.string().min(1),requesterId:z.string().min(1),name:mcpNameSchema,endpoint:endpointSchema.nullable(),purpose:z.string().min(1).max(2000),policyVersion:z.number().int().positive(),status:z.enum(['DRAFT','PENDING','APPROVED','DENIED','CANCELLED','CONSUMED','EXPIRED']),createdAt:z.number(),scope:z.enum(['once','company']).optional(),expiresAt:z.number().nullable().optional(),reviewedBy:z.string().optional(),reviewedAt:z.number().optional(),reason:z.string().optional()}).strict().superRefine((value,ctx)=>{if(value.status==='APPROVED'&&(!value.endpoint||!value.scope||!value.reviewedBy||value.reviewedAt==null||!value.reason||value.scope==='once'&&(value.expiresAt==null||value.expiresAt<=value.reviewedAt)))ctx.addIssue({code:'custom',message:'An approval requires verified reviewer, scope, endpoint and expiry evidence.'});});
export type McpRequest=z.infer<typeof mcpRequestSchema>;
export const isMcpConnectionPrompt=(task:string)=>/\bmcp\b/i.test(task)&&/\b(connect|configure|add|install|download)\b/i.test(task);
export function nameFromPrompt(task:string){
 const match=task.match(/\b(?:connect|configure|add|install|download)\s+(?:(?:with|to|the|a|an)\s+)*([a-zA-Z0-9][a-zA-Z0-9 ._-]*?)\s+mcp\b/i);
 if(match?.[1])return mcpNameSchema.parse(match[1].trim());
 // A pasted link names the server: site name plus a "<name>-mcp" path segment (docs.parallel.ai/.../search-mcp → "Parallel Search").
 const link=task.match(/https:\/\/[^\s]+/)?.[0];
 if(link){try{const url=new URL(link);const site=url.hostname.split('.').slice(-2)[0];const part=url.pathname.split('/').map(segment=>segment.match(/^([a-z0-9]+)-mcp$/i)?.[1]).find(Boolean);
  const title=(word:string)=>word[0].toUpperCase()+word.slice(1).toLowerCase();const name=[site,part].filter((word):word is string=>Boolean(word)&&/^[a-z0-9]+$/i.test(word!)).map(title).join(' ');
  if(name)return mcpNameSchema.parse(name);}catch{/* fall through */}}
 return mcpNameSchema.parse('New MCP');
}

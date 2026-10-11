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
// An MCP-looking link: "mcp" as a host label or path segment (mcp.sentry.dev/mcp, example.com/mcp, /sse endpoints).
const mcpLink=(task:string)=>(task.match(/https:\/\/[^\s'"<>]+/g)??[]).find(link=>{try{const url=new URL(link);return url.hostname.split('.').some(label=>/^mcp$|-mcp$|^mcp-/i.test(label))||url.pathname.split('/').some(segment=>/^(mcp|sse)$|-mcp$/i.test(segment));}catch{return false;}});
// Pasted install commands and configs: `claude mcp add …`, `code --add-mcp '{…}'`, an "mcpServers" block.
const installCommand=/\bmcp\s+add\b|--add-mcp\b|"?mcpServers"?\s*:/i;
export const isMcpConnectionPrompt=(task:string)=>(/\bmcp\b/i.test(task)&&/\b(connect|configure|add|install|download)\b/i.test(task))||installCommand.test(task)||Boolean(mcpLink(task));
// The public HTTPS endpoint named in the message, if any, to pre-fill the request form.
export function endpointFromPrompt(task:string){const link=mcpLink(task)??task.match(/https:\/\/[^\s'"<>]+/)?.[0];if(!link)return null;const parsed=endpointSchema.safeParse(link.replace(/[).,;]+$/,''));return parsed.success?parsed.data:null;}
export function nameFromPrompt(task:string){
 const match=task.match(/\b(?:connect|configure|add|install|download)\s+(?:(?:with|to|the|a|an)\s+)*([a-zA-Z0-9][a-zA-Z0-9 ._-]*?)\s+mcp\b/i);
 if(match?.[1])return mcpNameSchema.parse(match[1].trim());
 // Install commands carry the name: "name":"playwright" or `mcp add playwright …`.
 const named=task.match(/"name"\s*:\s*"([a-zA-Z0-9][a-zA-Z0-9 ._-]{0,60})"/)?.[1]??task.match(/\bmcp\s+add\s+(?:--?[a-z-]+(?:\s+\S+)?\s+)*([a-zA-Z0-9][a-zA-Z0-9._-]{0,60})/i)?.[1];
 if(named){const title=named.replace(/[-_]mcp$/i,'').replace(/[-_]+/g,' ').trim();if(title)return mcpNameSchema.parse(title[0].toUpperCase()+title.slice(1));}
 // A pasted link names the server: site name plus a "<name>-mcp" path segment (docs.parallel.ai/.../search-mcp → "Parallel Search").
 const link=task.match(/https:\/\/[^\s]+/)?.[0];
 if(link){try{const url=new URL(link);const site=url.hostname.split('.').slice(0,-1).filter(label=>!/^(mcp|www|api|docs)$/i.test(label)).at(-1);const part=url.pathname.split('/').map(segment=>segment.match(/^([a-z0-9]+)-mcp$/i)?.[1]).find(Boolean);
  const title=(word:string)=>word[0].toUpperCase()+word.slice(1).toLowerCase();const name=[site,part].filter((word):word is string=>Boolean(word)&&/^[a-z0-9]+$/i.test(word!)).map(title).join(' ');
  if(name)return mcpNameSchema.parse(name);}catch{/* fall through */}}
 return mcpNameSchema.parse('New MCP');
}

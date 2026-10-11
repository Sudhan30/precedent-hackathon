import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {publicMcpFetch} from './public-fetch.js';
import {policySchema,type Policy} from '../contracts/index.js';
export const tenableEndpoint='https://developer.tenable.com/mcp';
export function mcpDecision(policy:Policy,mode:'baseline'|'governed'){
 const verified=policySchema.safeParse(policy);if(!verified.success)return {verdict:'BLOCK' as const,policyVersion:0,ruleId:'POLICY-01',reason:'Authoritative MCP policy could not be verified.'};
 return {verdict:mode==='baseline'||policy.tenableAllowed===true?'ALLOW' as const:'BLOCK' as const,policyVersion:policy.version,ruleId:mode==='baseline'?'BASELINE':'MCP-01',reason:mode==='baseline'?'Comparison: company MCP permission is not enforced. Service authentication still applies.':policy.tenableAllowed?'Company policy permits connecting Tenable documentation MCP.':'Company policy blocks Tenable MCP connections. Ask an administrator to review MCP access.'};
}
export interface McpDiscovery {status:'CONNECTED'|'CONFIGURATION_REQUIRED'|'CONNECTION_FAILED';tools:string[];message:string;}
export async function discoverTenable():Promise<McpDiscovery>{
 return discoverHttpMcp(tenableEndpoint);
}
// General endpoints must be explicitly reviewed; publicMcpFetch pins public DNS and forbids redirects.
export const discoverReviewedMcp=(endpoint:string)=>discoverHttpMcp(endpoint,{},publicMcpFetch(endpoint));
export async function discoverHttpMcp(endpoint:string,headers:Record<string,string>={},fetcher:typeof fetch=fetch):Promise<McpDiscovery>{
 const deadline=AbortSignal.timeout(20000);
 const client=new Client({name:'precedent',version:'1.0.0'});
 const transport=new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers},fetch:(url,init)=>fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(15000),...(init?.signal?[init.signal]:[])])})});
 try{
  await client.connect(transport,{timeout:15000});const tools:string[]=[];let cursor:string|undefined;
  for(let page=0;page<20;page++){
   const result=await client.listTools(cursor?{cursor}:{},{timeout:15000});tools.push(...result.tools.map(tool=>tool.name));cursor=result.nextCursor;
   if(!cursor)return {status:'CONNECTED',tools:[...new Set(tools)],message:'MCP handshake and tool discovery succeeded. No discovered tool was executed; connection permission alone does not authorize tools.'};
  }
  throw new Error('Discovery exceeded page limit');
 }catch{return {status:'CONNECTION_FAILED',tools:[],message:'MCP connection failed. Verify endpoint availability and network access.'};}
 finally{await client.close().catch(()=>undefined);}
}

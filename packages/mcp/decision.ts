import {policySchema,type Policy} from '../contracts/index.js';
import {mcpKey} from './contracts.js';
export interface McpConnectionDecision{verdict:'ALLOW'|'BLOCK'|'REQUIRE_APPROVAL';policyVersion:number;ruleId:string;reason:string;endpoint?:string}
// Pure governed decision for a reviewed (non-Tenable) MCP connection. It never
// contacts a server, so counterfactual replay can evaluate draft policies safely.
export function mcpConnectionDecision(policy:Policy,name:string,endpoint?:string|null):McpConnectionDecision{
 const verified=policySchema.safeParse(policy);if(!verified.success)return {verdict:'BLOCK',policyVersion:0,ruleId:'POLICY-01',reason:'Authoritative MCP policy could not be verified.'};
 const configured=verified.data.mcpConnections?.find(item=>item.key===mcpKey(name));
 if(!configured)return {verdict:'REQUIRE_APPROVAL',policyVersion:policy.version,ruleId:'MCP-01',reason:'This MCP is not configured in company policy.'};
 if(!configured.allowed)return {verdict:'BLOCK',policyVersion:policy.version,ruleId:'MCP-01',reason:'Company policy blocks this MCP connection.',endpoint:configured.endpoint};
 if(endpoint&&configured.endpoint!==endpoint)return {verdict:'BLOCK',policyVersion:policy.version,ruleId:'MCP-01',reason:'Current MCP policy permits only its reviewed endpoint.',endpoint:configured.endpoint};
 return {verdict:'ALLOW',policyVersion:policy.version,ruleId:'MCP-01',reason:'Reviewed company MCP policy permits this endpoint.',endpoint:configured.endpoint};
}

// MCP-04: an approval recommendation for InfoSec. Evidence comes from MongoDB (who asked, from
// which departments) and Raindrop (how runs for this MCP went over the last 7 days). Raindrop
// informs and policy decides: this only recommends; an administrator still makes the decision.
export interface McpRaindropEvidence{status:'OK'|'UNAVAILABLE'|'NOT_CONFIGURED';events:number;negativeSignals:string[];connectionAttempts:number;connectionErrors:number}
export interface McpRecommendation{ruleId:'MCP-04';priority:'Normal'|'Raised'|'High';action:'approve-company'|'one-time-only'|'review';text:string}
export const priorityFor=(requesters:number):McpRecommendation['priority']=>requesters>=3?'High':requesters===2?'Raised':'Normal';
export function recommendMcp(input:{requesters:number;searchRelated:boolean;raindrop:McpRaindropEvidence}):McpRecommendation{
 const priority=priorityFor(input.requesters),base={ruleId:'MCP-04' as const,priority};
 if(input.searchRelated)return {...base,action:'review',text:'Blocked by MCP-03; nothing to approve.'};
 if(input.raindrop.status!=='OK')return {...base,action:'review',text:'No Raindrop evidence available; priority uses the requester count only.'};
 const errorRate=input.raindrop.connectionAttempts?input.raindrop.connectionErrors/input.raindrop.connectionAttempts:0;
 if(input.raindrop.negativeSignals.length||errorRate>0.05)return {...base,action:'one-time-only',text:`Recommend one-time approvals only: ${input.raindrop.negativeSignals.length?`Raindrop flagged ${input.raindrop.negativeSignals.join(', ')}`:`${Math.round(errorRate*100)}% of connection attempts failed`}. A company-wide approval needs a written reason.`};
 if(input.requesters>=3)return {...base,action:'approve-company',text:`Recommend approving company-wide: ${input.requesters} people asked and Raindrop shows no problems.`};
 return {...base,action:'review',text:`Review this request; ${input.requesters===1?'one person has':`${input.requesters} people have`} asked so far and Raindrop shows no problems.`};
}

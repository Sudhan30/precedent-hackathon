import {playbookInstructions,type Playbook,type PlaybookIndex} from './index.js';
const gateway='https://agentengine.mongodb.com';
// MongoDB Atlas Agent Engine procedural memory (Public Preview). Preferred setup is a
// service account (PROJECT_OWNER): AGENTIC_MEMORY_CLIENT_ID + AGENTIC_MEMORY_CLIENT_SECRET.
// Access tokens are minted with the documented client-credentials exchange and last one
// hour, so they are renewed before expiry. A pre-minted AGENTIC_MEMORY_SERVICE_ACCOUNT_TOKEN
// also works until it expires. Absent configuration means no index.
export function agentEngineIndex(fetcher:typeof fetch=fetch):PlaybookIndex|undefined{
 const clientId=process.env.AGENTIC_MEMORY_CLIENT_ID,clientSecret=process.env.AGENTIC_MEMORY_CLIENT_SECRET,staticToken=process.env.AGENTIC_MEMORY_SERVICE_ACCOUNT_TOKEN;
 if(!(clientId&&clientSecret)&&!staticToken)return undefined;
 const base=process.env.AGENTIC_MEMORY_BASE_URL||gateway;let cached:{token:string;expiresAt:number}|undefined;
 const token=async()=>{
  if(!(clientId&&clientSecret))return staticToken!;
  if(cached&&cached.expiresAt>Date.now()+120000)return cached.token;
  const response=await fetcher(new URL('/api/v1/oauth/token',base),{method:'POST',headers:{Authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',redirect:'error',signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({})) as {access_token?:unknown;expires_in?:unknown};
  if(!response.ok||typeof body.access_token!=='string')throw new Error('Agent Engine token exchange failed');
  cached={token:body.access_token,expiresAt:Date.now()+(typeof body.expires_in==='number'?body.expires_in:3600)*1000};return cached.token;
 };
 // One SDK client per access token; the token is never logged or stored.
 let client:{token:string;memory:any}|undefined;
 const memory=async()=>{const current=await token();if(client?.token!==current){const {Memory}=await import('@mongodb-js/agent-engine-sdk-memory');client={token:current,memory:new Memory({serviceAccountToken:current,baseUrl:base,projectId:process.env.AGENTIC_MEMORY_PROJECT_ID||null,fetchImpl:fetcher as any})};}return client.memory;};
 return {
  engine:'atlas-agent-engine',
  async save(p:Playbook){
   const m=await memory();
   await m.saveProcedure({procedure:p.id,description:p.title,userId:p.tenantId,visibility:'private',tags:['precedent',p.demoRunId],
    triggerConditions:[p.taskSummary],allowedTools:p.steps.map(s=>s.toolId),
    steps:p.steps.map((s,index)=>({order:index+1,toolId:s.toolId,resourceId:s.resourceId,environment:s.environment,purpose:s.purpose??null,finding:s.finding??null})),
    content:playbookInstructions(p)});
  },
  async discover(task:string,tenantId:string,topK:number,_candidates:Playbook[]){
   const m=await memory();const rows:Record<string,unknown>[]=await m.discoverProcedures({query:task,userId:tenantId,topK,tags:['precedent']});
   return rows.map(row=>row.procedure??row.procedure_name??row.name??(row.metadata as Record<string,unknown>|undefined)?.procedure).filter((id):id is string=>typeof id==='string');
  }
 };
}

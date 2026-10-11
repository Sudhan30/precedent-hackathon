import {evaluate} from '../policy-engine/index.js';
import type {Action,Policy,Grant,Verdict} from '../contracts/index.js';
export function runEvaluations(){
 const action:Action={actorId:'engineer-1',agentId:'eval',sessionId:'eval',toolId:'internal_logs.search',resourceId:'customer-logs',environment:'production'};
 const policy:Policy={version:1,sandboxAllowed:true,quarantined:[]};
 const cases:{label:string;action:Action;policy:Policy;grants:Grant[];now:number;expected:Verdict}[]=[];
 const add=(label:string,a:Action,p:Policy,expected:Verdict,grants:Grant[]=[],now=100)=>cases.push({label,action:a,policy:p,expected,grants,now});
 for(const toolId of ['example_connector.analyze','demo_export.send'] as const){for(const environment of ['production','sandbox'] as const){
 add(`${toolId} restricted ${environment}`,{...action,toolId,environment},policy,'BLOCK');
 add(`${toolId} synthetic ${environment}`,{...action,toolId,resourceId:'sandbox-logs',environment},policy,environment==='sandbox'?'ALLOW':'BLOCK');
 add(`${toolId} disabled ${environment}`,{...action,toolId,resourceId:'sandbox-logs',environment},{...policy,sandboxAllowed:false},'BLOCK');
 add(`${toolId} quarantine ${environment}`,{...action,toolId,resourceId:'sandbox-logs',environment},{...policy,quarantined:[`${toolId}@2.4`]},'BLOCK');
 }}
 for(const resourceId of ['customer-logs','sandbox-logs'] as const)for(const environment of ['production','sandbox'] as const){add(`internal ${resourceId} ${environment}`,{...action,resourceId,environment},policy,'ALLOW');add(`internal quarantined ${resourceId} ${environment}`,{...action,resourceId,environment},{...policy,quarantined:['internal_logs.search@1.0']},'BLOCK');}
 const staging:Action={...action,toolId:'staging_db.read',resourceId:'staging-records'};
 const grant:Grant={id:'eval-grant',action:staging,policyVersion:1,toolVersion:'1.0',revoked:false,consumed:false,expiresAt:200};
 add('staging missing grant',staging,policy,'REQUIRE_APPROVAL');add('staging valid grant',staging,policy,'ALLOW',[grant]);
 for(const now of [199,200,201])add(`staging expiry boundary ${now}`,staging,policy,now<200?'ALLOW':'REQUIRE_APPROVAL',[grant],now);
 add('staging consumed',staging,policy,'REQUIRE_APPROVAL',[{...grant,consumed:true}]);add('staging stale',staging,{...policy,version:2},'REQUIRE_APPROVAL',[grant]);add('staging quarantine',staging,{...policy,quarantined:['staging_db.read@1.0']},'BLOCK',[grant]);
 for(const field of ['actorId','agentId','sessionId','toolId','resourceId','environment'] as const)add(`grant mismatch ${field}`,staging,policy,'REQUIRE_APPROVAL',[{...grant,action:{...staging,[field]:'other'} as Action}]);
 for(const actorId of ['','admin','unknown'])add(`untrusted actor ${actorId}`,{...action,actorId},policy,'BLOCK');
 for(const field of ['sessionId','agentId'] as const)add(`missing ${field}`,{...action,[field]:''},policy,'BLOCK');
 for(const toolId of ['internal_logs.search','example_connector.analyze','demo_export.send'] as const)add(`incompatible staging ${toolId}`,{...staging,toolId},policy,'BLOCK');
 for(const resourceId of ['customer-logs','sandbox-logs'] as const)add(`staging incompatible ${resourceId}`,{...staging,resourceId},policy,'BLOCK');
 add('unknown tool',{...action,toolId:'unknown' as Action['toolId']},policy,'BLOCK');add('unknown environment',{...action,environment:'unknown' as Action['environment']},policy,'BLOCK');
 const results=cases.map(c=>{const actual=evaluate(c.action,c.policy,c.grants,c.now).verdict;return {label:c.label,expected:c.expected,actual,passed:actual===c.expected};});
 return {source:'Executed deterministic policy cases; not model evaluation',total:results.length,passed:results.filter(r=>r.passed).length,falseAllows:results.filter(r=>r.actual==='ALLOW'&&r.expected!=='ALLOW').length,results};
}

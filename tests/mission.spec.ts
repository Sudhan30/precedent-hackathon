import {test,expect,type Page} from '@playwright/test';
// Drive the real API with the tab's demo identities so Mission Control renders recorded history.
async function apiAs(page:Page,role:'employee'|'admin',path:string,body?:unknown){
 return page.evaluate(async({role,path,body})=>{const tokens=JSON.parse(sessionStorage.getItem('precedent.demo-tokens')??'{}');const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw new Error(path+': '+data.error);return data;},{role,path,body});
}
test('Mission Control shows a learned playbook, a self-written guardrail and the kill switch',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByRole('link',{name:'Mission Control'})).toBeVisible();
 // Earlier stories share this server; start a fresh demo namespace (audit history is kept).
 const initial=await apiAs(page,'admin','state');await apiAs(page,'admin','demo/reset',{expectedVersion:initial.policy.version,expectedDemoRunId:initial.demo.demoRunId});
 // Feature 2 history: Agent A learns the hard way, then a fresh agent gets a similar task.
 await apiAs(page,'employee','comparison',{task:'Investigate why checkout is failing for customer Globex',scenario:'investigation',planner:'fixture',target:'governed',memory:'none'});
 await apiAs(page,'employee','comparison',{task:'Why is checkout failing for customer Initech?',scenario:'investigation',planner:'fixture',target:'governed'});
 // Feature 1 history: the same sandbox export is held and approved in two sessions.
 const state=await apiAs(page,'admin','state');
 await apiAs(page,'admin','policy',{expectedVersion:state.policy.version,sandboxAllowed:false,sandboxApprovalRequired:true,reason:'Require review for sandbox exports'});
 for(let i=0;i<2;i++){
  const held=(await apiAs(page,'employee','comparison',{task:'Export the synthetic sandbox logs',scenario:'sandbox-export',planner:'fixture',target:'governed'})).runs[0].executions[0];
  await apiAs(page,'admin','approvals/'+held.id,{allow:true,ttlSeconds:30});await apiAs(page,'employee','resume/'+held.id,{});
 }
 await page.getByRole('link',{name:'Mission Control'}).click();await expect(page).toHaveURL(/\/mission$/);
 const panel=page.getByRole('tabpanel');
 // Mission Control opens on the guardrails tab (demo order); playbooks is the last tab.
 await page.getByRole('tab',{name:/Learned playbooks/}).click();
 await expect(panel).toContainText('Investigate why checkout is failing for customer Globex');
 await expect(panel).toContainText('Internal log search');await expect(panel).toContainText('Agent B followed the playbook');await expect(panel).toContainText('Agent A (first day)');
 await page.screenshot({path:'.data/mission-playbooks.png',fullPage:true});
 await page.getByRole('tab',{name:/Self-writing guardrails/}).click();
 await expect(panel).toContainText('Suggested rule');await expect(panel).toContainText('past decisions would change');
 await expect(panel.locator('.mc-checks li.pass')).toHaveCount(3);
 await page.screenshot({path:'.data/mission-guardrails.png',fullPage:true});
 await panel.getByRole('button',{name:'Publish rule'}).click();await expect(panel).toContainText('Precedent rewrote its own guardrail');
 await page.getByRole('tab',{name:/Kill switch/}).click();
 await panel.getByRole('button',{name:'1 · Report incident'}).click();await expect(panel).toContainText('Blast radius');
 await expect(panel).toContainText('Restricted customer data: not exposed');
 await page.screenshot({path:'.data/mission-blast-radius.png',fullPage:true});
 await panel.getByRole('button',{name:'2 · Quarantine v2.4'}).click();await expect(panel).toContainText('Quarantined');
 await panel.getByRole('button',{name:'3 · Send test call'}).click();
 await expect(panel).toContainText('Test call: BLOCKED');await expect(panel).toContainText('unchanged');
 await page.screenshot({path:'.data/mission-kill-switch.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

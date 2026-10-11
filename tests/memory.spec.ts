import {test,expect,type Page,type Browser} from '@playwright/test';
const question='Weekly active customers by region last quarter';
async function apiAs(page:Page,role:'employee'|'admin',path:string,body?:unknown){
 return page.evaluate(async({role,path,body})=>{const tokens=JSON.parse(sessionStorage.getItem('precedent.demo-tokens')??'{}');const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw new Error(path+': '+data.error);return data;},{role,path,body});
}
// Each user is a separate browser context, so a separate demo identity and session.
async function userIn(browser:Browser,department:string){
 const page=await (await browser.newContext()).newPage();await page.goto('/',{waitUntil:'domcontentloaded'});
 const picker=page.getByRole('form',{name:'Choose your department'});await picker.getByRole('combobox',{name:'Department'}).selectOption(department);await picker.getByRole('button',{name:'Save department'}).click();
 await expect(page.locator('.department-chip')).toContainText(department[0].toUpperCase()+department.slice(1));return page;
}
async function askWarehouse(page:Page){
 const governed=page.locator('.governed');await governed.getByRole('button',{name:/Query the data warehouse/}).click();
 await expect(governed.getByRole('textbox')).toHaveValue(question);await governed.getByRole('button',{name:'Send message'}).click();
 await expect(page.locator('[aria-label="governed run status"]')).toContainText('FINISHED');return governed;
}
test('agent memory: learn with a user hint, approve for the department, reuse by a colleague, never leak to another department',async({page,browser})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/',{waitUntil:'domcontentloaded'});await expect(page.getByRole('link',{name:'Mission Control'})).toBeVisible();
 const initial=await apiAs(page,'admin','state');await apiAs(page,'admin','demo/reset',{expectedVersion:initial.policy.version,expectedDemoRunId:initial.demo.demoRunId});
 await page.reload({waitUntil:'domcontentloaded'});
 const picker=page.getByRole('form',{name:'Choose your department'});await picker.getByRole('combobox',{name:'Department'}).selectOption('engineering');await picker.getByRole('button',{name:'Save department'}).click();
 await expect(page.locator('.department-chip')).toContainText('Engineering');await expect(picker).toHaveCount(0);
 // Scenario 2: the first attempt finds nothing; the user points to the right table.
 let governed=await askWarehouse(page);await expect(governed).toContainText('acme_dw.customers');
 const hint=governed.getByRole('form',{name:'governed table hint'});await hint.getByRole('textbox',{name:'BigQuery table'}).fill('acme_dw.t_04417');
 await hint.getByRole('textbox',{name:'Definitions (optional)'}).fill('Active means at least one order in the trailing 7 days.');await hint.getByRole('button',{name:'Ask again with this table'}).click();
 const card=page.getByRole('article',{name:'Agent memory proposal'});await expect(card).toContainText('Add this to agent memory?');await expect(card).toContainText('CHECKPOINT-OK');
 await page.screenshot({path:'.data/memory-proposal.png',fullPage:true});
 await card.getByRole('button',{name:'Add to agent memory (engineering department)'}).click();await expect(card).toContainText('Saved to agent memory');
 // Scenario 3a: a second engineer reuses the approved memory on the first try.
 const colleague=await userIn(browser,'engineering');governed=await askWarehouse(colleague);
 await expect(governed).toContainText('acme_dw.t_04417');await expect(governed.getByRole('form',{name:'governed table hint'})).toHaveCount(0);
 // Scenario 3b: another department stays cold.
 const sales=await userIn(browser,'sales');governed=await askWarehouse(sales);
 await expect(governed).toContainText('acme_dw.customers');await expect(governed.getByRole('form',{name:'governed table hint'})).toBeVisible();
 await page.getByRole('link',{name:'Mission Control'}).click();await page.getByRole('tab',{name:/Agent memory/}).click();
 const panel=page.getByRole('tabpanel');await expect(panel).toContainText('acme_dw.t_04417');await expect(panel).toContainText('A colleague in engineering got the answer');
 await page.screenshot({path:'.data/memory-mission.png',fullPage:true});
 expect(errors).toEqual([]);
});

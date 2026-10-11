import {test,expect,type Page} from '@playwright/test';
async function go(page:Page,area:'admin'|'workspace',advanced=true){await page.getByRole('link',{name:area==='admin'?'Admin console':'User workspace',exact:true}).click();if(area==='admin'&&advanced&&!await page.locator('.admin-advanced').evaluate((element:HTMLDetailsElement)=>element.open))await page.getByText('Advanced governance',{exact:true}).click();}
test('accepted comparisons show persisted progress and recover their panels after reload',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();
 const response=page.waitForResponse(response=>response.url().endsWith('/api/comparison')&&response.request().method()==='POST');
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 const accepted=await response;expect(accepted.status()).toBe(202);const {comparisonId}=await accepted.json();
 await expect(page.locator('[aria-label="governed run status"]')).toContainText('FINISHED');
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('[aria-label="governed run status"]')).toContainText('FINISHED');
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 expect(await page.evaluate(()=>sessionStorage.getItem('precedent.comparison'))).toBe(comparisonId);
 await go(page,'workspace');await page.locator('.governed').getByRole('button',{name:'Run this action again'}).click();
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(2);
 await expect(page.locator('[role="alert"]')).toHaveCount(0);
});
test('browser comparison, receipt evidence, dynamic policy, approvals and replay',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .BLOCKED')).toHaveCount(1);
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 await expect(page.locator('.baseline .SUCCEEDED')).toHaveCount(1);
 await expect(page.locator('.governed')).toContainText('receipt none');
 await page.locator('.governed').getByText(/Inspect context/).click();
 await expect(page.locator('.governed').getByRole('heading',{name:'Semantic policy memory'})).toBeVisible();
 await expect(page.locator('.governed')).toContainText('Current policy v');
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed')).toContainText('Run outcome · FINISHED');
 await expect(page.locator('.governed')).toContainText('Permitted alternative completed: internal_logs.search');
 await go(page,'workspace');await page.getByRole('combobox',{name:'Demo scenario'}).selectOption('sandbox');
 await go(page,'admin');await page.getByRole('button',{name:'Disable sandbox exports'}).click();
 const policyReview=page.getByRole('region',{name:'Policy change review'});await expect(policyReview).toContainText('Direct sandbox exports');await page.getByRole('textbox',{name:'Reason for this change'}).fill('Disable sandbox exports for a reviewed demo policy change');await page.getByRole('button',{name:'Publish reviewed policy',exact:true}).click();
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .BLOCKED')).toHaveCount(1);
 await go(page,'workspace');await page.getByRole('combobox',{name:'Demo scenario'}).selectOption('staging');
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .PENDING')).toHaveCount(1);
 await go(page,'admin');await page.getByRole('button',{name:'Approve 30 seconds'}).last().click();
 await go(page,'workspace');await page.getByRole('button',{name:'Resume after approval'}).click();
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 await go(page,'admin');await page.getByRole('button',{name:'Inspect original'}).first().click();
 const inspection=page.getByRole('region',{name:'Original decision'});await expect(inspection).toContainText('Recorded verdict: ALLOW');await expect(inspection).toContainText('Receipt confirmed');
 await inspection.getByText('Approval evidence at decision and later review',{exact:true}).click();await expect(inspection).toContainText('Snapshot: within recorded time window');await expect(inspection).toContainText('consumed');await inspection.screenshot({path:'.data/verified-original-decision.png'});
 await page.getByRole('button',{name:/Compare v/}).first().click();
 await expect(page.getByRole('status')).toContainText('0 side effects');
 expect(errors).toEqual([]);
});
test('same-session quarantine and 30-second expiration affect actual execution',async({page})=>{
 test.setTimeout(70000);
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Run comparison'})).toBeEnabled();
 await go(page,'admin');if(await page.getByRole('button',{name:'Enable sandbox exports'}).count()){await page.getByRole('button',{name:'Enable sandbox exports'}).click();await page.getByRole('button',{name:'Publish reviewed policy',exact:true}).click();}
 await go(page,'workspace');await page.getByRole('combobox',{name:'Demo scenario'}).selectOption('sandbox');
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 await go(page,'admin');await page.getByRole('button',{name:'Quarantine connector v2.4'}).click();
 await go(page,'workspace');await page.locator('.governed').getByRole('button',{name:'Run this action again'}).click();
 await expect(page.locator('.governed .BLOCKED')).toHaveCount(1);
 await go(page,'workspace');await page.getByRole('combobox',{name:'Demo scenario'}).selectOption('staging');
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .PENDING')).toHaveCount(1);
 await go(page,'admin');await page.getByRole('button',{name:'Approve 30 seconds'}).last().click();
 await page.getByText(/Temporary access history/).click();await expect(page.getByText(/Grant .* expired/)).toBeVisible({timeout:35000});
 await go(page,'workspace');await page.locator('.governed').getByRole('button',{name:'Resume after approval'}).click();
 await expect(page.locator('.governed .PENDING')).toHaveCount(2);
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(0);
 await page.screenshot({path:'.data/verified-demo.png',fullPage:true});
});
test('administrator reviews an approval-backed policy proposal in the dashboard',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Run comparison'})).toBeEnabled();
 await go(page,'admin');await page.getByRole('button',{name:'Enable scoped sandbox approvals'}).click();await page.getByRole('button',{name:'Publish reviewed policy',exact:true}).click();
 await go(page,'admin');if(await page.getByRole('button',{name:'Disable sandbox exports',exact:true}).count()){await go(page,'admin');await page.getByRole('button',{name:'Disable sandbox exports',exact:true}).click();await page.getByRole('button',{name:'Publish reviewed policy',exact:true}).click();}
 await go(page,'workspace');await page.getByRole('combobox',{name:'Demo scenario'}).selectOption('sandbox-export');
 for(let i=0;i<2;i++){
  await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
  await expect(page.locator('.governed .PENDING')).toHaveCount(1);
  await go(page,'admin');await page.getByRole('button',{name:'Approve 30 seconds'}).last().click();
  await go(page,'workspace');await page.locator('.governed').getByRole('button',{name:'Resume after approval'}).click();
  await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 }
 await go(page,'admin');await page.getByRole('button',{name:'Analyze recent decisions'}).click();
 await expect(page.getByText('Proposed rule: allow engineer-1 to use demo_export.send@2.4 with sandbox-logs in sandbox.')).toBeVisible();
 await page.getByRole('button',{name:'Publish reviewed proposal'}).click();
 await expect(page.getByText(/PUBLISHED · base policy/)).toBeVisible();
 await go(page,'workspace');await page.locator('.governed').getByRole('button',{name:'Run this action again'}).click();
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(2);
 await expect(page.locator('.governed')).toContainText('Reviewed scoped sandbox policy permits this action');
});
test('incident graph filters recorded evidence and preserves receipts after quarantine',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();await go(page,'admin');await page.getByRole('button',{name:'Quarantine connector v2.4'}).click();const graph=page.getByRole('region',{name:'Incident usage graph'});await expect(graph).toBeVisible();
 await graph.getByRole('combobox',{name:'Graph tool version'}).selectOption('example_connector.analyze@2.4');
 await expect(graph).toContainText('version 2.4 · quarantined');
 await graph.getByRole('combobox',{name:'Graph evidence type'}).selectOption('blocked');
 await expect(graph.locator('.graph-evidence .audit').first()).toContainText('blocked');await expect(graph.locator('.graph-evidence')).not.toContainText('Baseline bypass');
 await graph.getByRole('combobox',{name:'Graph evidence type'}).selectOption('executed');
 await expect(graph.locator('.graph-evidence')).toContainText('Baseline bypass');await expect(graph.locator('.graph-evidence')).not.toContainText('Receipt none');
 await graph.screenshot({path:'.data/verified-incident-graph.png'});
});

test('new demo closes old sessions and retains historical replay in the dashboard',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 await go(page,'admin');await page.getByText('Start a new demo',{exact:true}).click();
 await page.getByRole('button',{name:'Start new demo',exact:true}).click();
 await expect(page.locator('.governed')).toContainText('What can I help you with?');
 await expect(page.getByText(/archived demos · audit history retained/)).toBeVisible();
 await go(page,'admin');await page.getByRole('button',{name:'Inspect original'}).first().click();await expect(page.getByRole('region',{name:'Original decision'})).toContainText('Original recorded decision');
 await page.getByRole('button',{name:/Compare v/}).first().click();await expect(page.getByRole('status')).toContainText('0 side effects');
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 await expect(page.locator('.governed')).toContainText('0 persisted experiences retrieved from other sessions.');
 await expect(page.getByRole('alert')).toHaveCount(0);
});

test('stale policy review cannot overwrite an intervening quarantine',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();await page.getByText('Run options',{exact:true}).click();await expect(page.getByRole('button',{name:'Run comparison'})).toBeEnabled();
 await go(page,'admin');const toggle=page.getByRole('button',{name:/^(Enable|Disable) sandbox exports$/});await toggle.click();const review=page.getByRole('region',{name:'Policy change review'});await expect(review).toBeVisible();
 await review.screenshot({path:'.data/verified-policy-review.png'});await go(page,'admin');await page.getByRole('button',{name:'Quarantine connector v2.4'}).click();
 await expect(review).toContainText('This review is stale');await expect(review.getByRole('button',{name:'Publish reviewed policy',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Cancel policy review'}).click();await expect(review).toHaveCount(0);
});


test('chat workspace shares the submitted prompt, reveals real results and retains supporting controls',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.getByText('Send the same prompt to both agents',{exact:true}).click();
 await expect(page.getByRole('heading',{name:'One prompt. Two perspectives.'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Policy and evidence'})).toBeHidden();
 await page.getByRole('button',{name:'Use an MCP',exact:true}).click();
 const task='Investigate checkout errors using the connected MCP. Preserve this submitted prompt.';
 await page.getByRole('textbox',{name:'Ask both agents'}).fill(task);
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .SUCCEEDED')).toHaveCount(1);
 for(const mode of ['baseline','governed'])await expect(page.locator('.'+mode+' .user-message')).toContainText(task);
 await page.getByRole('textbox',{name:'Ask both agents'}).fill('Unsent draft must not alter the active conversations');
 for(const mode of ['baseline','governed'])await expect(page.locator('.'+mode+' .user-message')).toContainText(task);
 await page.locator('.governed').getByText('View tool result',{exact:true}).click();
 await expect(page.locator('.governed .tool-result pre')).not.toBeEmpty();
 await page.locator('.governed').getByText(/Inspect context/).click();
 await expect(page.locator('.governed').getByRole('heading',{name:'Semantic policy memory'})).toBeVisible();
 await page.screenshot({path:'.data/verified-chat-workspace.png',fullPage:true});
 await page.getByRole('button',{name:'Request staging access',exact:true}).click();
 await go(page,'workspace');await page.getByRole('button',{name:'Run comparison'}).click();
 await expect(page.locator('.governed .PENDING')).toHaveCount(1);
 await go(page,'workspace');await page.locator('.governed').getByRole('button',{name:'Review approval',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Approval requests',exact:true})).toBeVisible();
 await go(page,'admin');await expect(page.getByRole('heading',{name:'Audit & time machine',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Run policy evaluations',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('50/50 passed');
 await page.setViewportSize({width:390,height:844});
 await go(page,'workspace');
 await expect(page.getByRole('region',{name:'Policy and evidence'})).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.data/verified-chat-mobile.png',fullPage:true});
});

test('independent chats can send different prompts while the other side is waiting and recover after reload',async({page})=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});
 const left=page.getByRole('region',{name:'Without Precedent conversation',exact:true}),right=page.getByRole('region',{name:'With Precedent conversation',exact:true});
 const first='Investigate customer logs with the governed agent';const other='Investigate a different checkout issue without company context';
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/comparison',async route=>{if(route.request().postDataJSON().task===first)await held;await route.continue();});
 try{
  await right.getByRole('textbox',{name:'Message with Precedent',exact:true}).fill(first);
  await right.getByRole('button',{name:'Send message'}).click();
  await expect(right.getByRole('button',{name:'Sending'})).toBeDisabled();
  await left.getByRole('textbox',{name:'Message without Precedent',exact:true}).fill(other);
  await expect(left.getByRole('button',{name:'Send message'})).toBeEnabled();
  await left.getByRole('button',{name:'Send message'}).click();
  await expect(left.locator('[aria-label="baseline run status"]')).toContainText('FINISHED');
  await expect(left.locator('.user-message')).toContainText(other);
  // While held, the right side shows only the optimistic pending message; no run exists yet.
  await expect(right.locator('.pending-turn .user-message')).toContainText(first);
  await expect(right.locator('[aria-label="governed run status"]')).toHaveCount(0);
  release();
  await expect(right.locator('[aria-label="governed run status"]')).toContainText('FINISHED');
  await expect(right.locator('.user-message')).toContainText(first);
  await expect(right.locator('.BLOCKED')).toHaveCount(1);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(left.locator('.user-message')).toContainText(other);await expect(right.locator('.user-message')).toContainText(first);
  const composer=right.getByRole('textbox',{name:'Message with Precedent',exact:true});
  await composer.fill('Search the customer logs again');
  await composer.press('End');await composer.press('Shift+Enter');await composer.press('x');
  const followup='Search the customer logs again\nx';await expect(composer).toHaveValue(followup);
  await composer.dispatchEvent('keydown',{key:'Enter',isComposing:true});
  await expect(right.locator('.user-message')).toContainText(first);
  await expect(composer).toHaveValue(followup);
  await composer.press('Enter');
  await expect(right.locator('.user-message')).toContainText(followup);
  await expect(left.locator('.user-message')).toContainText(other);
  await right.getByText('Show 1 earlier message',{exact:true}).click();await expect(right.locator('.history-user')).toContainText(first);
  await expect(right.getByRole('textbox',{name:'Message with Precedent',exact:true})).toHaveValue('');
  await expect(right.getByLabel('governed run status')).toContainText('FINISHED');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'.data/chat-style-results-desktop.png',fullPage:true});
 }finally{release();}
});

test('separate admin and user pages govern a real Tenable documentation MCP connection',async({page})=>{
 test.setTimeout(90000);
 await page.goto('/workspace',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('region',{name:'Policy and evidence'})).toBeHidden();
 const governed=page.getByRole('region',{name:'With Precedent conversation',exact:true});
 await governed.getByRole('textbox',{name:'Message with Precedent',exact:true}).fill('Download Tenable MCP to read developer documentation');
 await governed.getByRole('button',{name:'Send message'}).click();
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('BLOCKED');
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('No connection attempted');
 await go(page,'admin',false);const permissions=page.getByRole('region',{name:'MCP permissions'});
 await permissions.getByRole('button',{name:'Change access'}).click();await permissions.getByRole('checkbox',{name:'Allow Tenable MCP connection'}).check();
 await permissions.getByRole('textbox',{name:'Reason for MCP changes'}).fill('Allow public documentation for the live MCP demonstration');
 await permissions.getByRole('button',{name:'Review changes'}).click();
 await permissions.getByRole('button',{name:'Save access changes'}).click();
 await expect(permissions.getByRole('button',{name:'Change access'})).toBeVisible();
 await page.screenshot({path:'.data/verified-admin-console.png',fullPage:true});
 await go(page,'workspace');await governed.getByRole('textbox',{name:'Message with Precedent',exact:true}).fill('Connect Tenable MCP to read its documentation');
 await governed.getByRole('button',{name:'Send message'}).click();
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('CONNECTED',{timeout:45000});
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('No discovered tool was executed');
 await governed.getByText(/Discovered tools/).click();await expect(governed.getByLabel('governed MCP connection result')).toContainText('search');
 await page.reload({waitUntil:'domcontentloaded'});await expect(governed.getByLabel('governed MCP connection result')).toContainText('CONNECTED');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.data/verified-tenable-workspace.png',fullPage:true});
 await go(page,'admin',false);await permissions.getByRole('button',{name:'Change access'}).click();await permissions.getByRole('checkbox',{name:'Allow Tenable MCP connection'}).uncheck();
 await permissions.getByRole('textbox',{name:'Reason for MCP changes'}).fill('Restore denied connection policy after verification');
 await permissions.getByRole('button',{name:'Review changes'}).click();await permissions.getByRole('button',{name:'Save access changes'}).click();
 await expect(permissions.getByRole('button',{name:'Change access'})).toBeVisible();
 await go(page,'workspace');await governed.getByRole('textbox',{name:'Message with Precedent',exact:true}).fill('Connect Tenable MCP');await governed.getByRole('button',{name:'Send message'}).click();
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('BLOCKED');
});


test('admin starts with plain-language access and keeps technical controls in Advanced',async({page})=>{
 await page.goto('/admin',{waitUntil:'domcontentloaded'});
 const permissions=page.getByRole('region',{name:'MCP permissions'});
 await expect(permissions.getByRole('button',{name:'Change access'})).toBeEnabled();
 await expect(page.getByRole('heading',{name:'Admin console',level:1})).toBeVisible();
 await expect(page.getByRole('region',{name:'Approval requests'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Recent activity'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Audit & time machine',exact:true})).toBeHidden();
 await expect(permissions.getByRole('textbox')).toHaveCount(0);
 let writes=0;page.on('request',request=>{if(request.url().endsWith('/api/mcp/policy'))writes++;});
 await permissions.getByRole('button',{name:'Change access'}).click();
 await permissions.getByRole('checkbox',{name:'Allow Internal log search',exact:true}).uncheck();
 await permissions.getByRole('textbox',{name:'Reason for MCP changes'}).fill('Review a temporary change without saving');
 await permissions.getByRole('button',{name:'Review changes'}).click();
 await expect(page.getByRole('region',{name:'Access change review'})).toContainText('Internal log search');
 await expect(page.getByRole('region',{name:'Access change review'})).toContainText('Allowed → Blocked');
 await permissions.getByRole('button',{name:'Cancel access changes'}).click();
 expect(writes).toBe(0);await expect(permissions.getByRole('textbox')).toHaveCount(0);
 await page.screenshot({path:'.data/intuitive-admin-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.data/intuitive-admin-mobile.png',fullPage:true});
 await page.getByText('Advanced governance',{exact:true}).click();await expect(page.getByRole('heading',{name:'Audit & time machine',exact:true})).toBeVisible();
});

test('prompt shortcuts select the matching scope without sending and approval navigation stays usable',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/workspace',{waitUntil:'domcontentloaded'});
 const left=page.getByRole('region',{name:'Without Precedent conversation',exact:true});
 const right=page.getByRole('region',{name:'With Precedent conversation',exact:true});
 const draft=right.getByRole('textbox',{name:'Message with Precedent',exact:true});
 let writes=0;page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(comparison|mcp\/comparison)$/.test(request.url()))writes++;});
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'.data/chat-style-empty-desktop.png',fullPage:true});
 expect(await right.getByRole('button',{name:'Send message',exact:true}).evaluate(node=>node.getBoundingClientRect().bottom<=window.innerHeight)).toBe(true);
 await expect(right.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await right.getByRole('button',{name:/Connect Tenable MCP/}).click();
 await expect(draft).toHaveValue('Connect Tenable MCP to read its developer documentation.');
 await expect(draft).toBeFocused();
 await expect(left.getByRole('textbox')).toHaveValue('');
 await right.getByRole('button',{name:/Request staging access/}).click();
 await expect(draft).toHaveValue('Use staging_db.read to check the staging records.');
 await right.locator('.chat-send-row summary').click();
 await expect(right.getByRole('combobox',{name:'governed data scope'})).toHaveValue('staging');
 await right.getByRole('button',{name:/Investigate checkout errors/}).click();
 await expect(right.getByRole('combobox',{name:'governed data scope'})).toHaveValue('investigation');
 expect(writes).toBe(0);
 await right.getByRole('button',{name:/Request staging access/}).click();
 await right.getByRole('button',{name:'Send message'}).click();
 await expect(right.locator('.PENDING')).toHaveCount(1);
 await page.getByRole('link',{name:'Admin console',exact:true}).click();
 await expect(page.getByLabel('Governance overview')).toContainText('Pending approvals');
 await expect(page.getByRole('region',{name:'Approval requests'}).getByRole('button',{name:'Approve 30 seconds'}).last()).toBeVisible();
 await page.screenshot({path:'.data/ui-refresh-admin-approval.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.data/ui-refresh-admin-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'User workspace',exact:true}).click();
 await expect(right.locator('.PENDING')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.data/chat-style-workspace-mobile.png',fullPage:true});
 expect(errors).toEqual([]);
});

test('unknown MCP offers request or cancel, admin reviews company access, and resume performs real discovery',async({page})=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/workspace',{waitUntil:'domcontentloaded'});
 const governed=page.getByRole('region',{name:'With Precedent conversation',exact:true});
 const prompt=governed.getByRole('textbox',{name:'Message with Precedent',exact:true});
 await prompt.fill('Connect with Docs Preview MCP');await governed.getByRole('button',{name:'Send message'}).click();
 const request=governed.getByRole('region',{name:'governed MCP request'});
 await expect(request.getByRole('button',{name:'Request admin approval'})).toBeVisible();
 await expect(request.getByRole('button',{name:'Cancel request'})).toBeVisible();
 await request.getByRole('button',{name:'Cancel request'}).click();await expect(governed.getByLabel('governed MCP connection result')).toContainText('CANCELLED');
 await prompt.fill('Connect Metrics Trial MCP');await governed.getByRole('button',{name:'Send message'}).click();
 await expect(request.getByRole('textbox',{name:'MCP name',exact:true})).toHaveValue('Metrics Trial');
 await request.getByRole('button',{name:'Cancel request'}).click();await expect(governed.getByLabel('governed MCP connection result')).toContainText('CANCELLED');
 await prompt.fill('Connect with Docs Preview MCP');await governed.getByRole('button',{name:'Send message'}).click();
 await request.getByRole('textbox',{name:'MCP endpoint'}).fill('https://developer.tenable.com/mcp');
 await request.getByRole('textbox',{name:'Why do you need it?'}).fill('Review the public Tenable documentation through a newly reviewed endpoint.');
 await request.getByRole('button',{name:'Request admin approval'}).click();
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('PENDING APPROVAL');
 await page.reload({waitUntil:'domcontentloaded'});await expect(request).toContainText('Waiting for an administrator');
 await go(page,'admin',false);const inbox=page.getByRole('region',{name:'Approval requests'});const item=inbox.locator('.mcp-admin-request').filter({hasText:'Docs Preview'});
 await expect(item).toContainText('https://developer.tenable.com/mcp');
 await item.getByRole('combobox',{name:'Decision scope for Docs Preview'}).selectOption('company');
 await item.getByRole('textbox',{name:'Reason for Docs Preview decision'}).fill('Allow this public documentation endpoint for future connection requests.');
 await item.getByRole('button',{name:'Review allow'}).click();await expect(item).toContainText('Publish a company policy for this exact endpoint.');
 await page.screenshot({path:'.data/new-mcp-admin-review.png',fullPage:true});
 await item.getByRole('button',{name:'Confirm allow'}).click();
 await expect(page.getByRole('region',{name:'MCP permissions'})).toContainText('Docs Preview MCP');
 await go(page,'workspace');await expect(request.getByRole('button',{name:'Resume MCP connection'})).toBeEnabled();
 await request.getByRole('button',{name:'Resume MCP connection'}).click();
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('CONNECTED',{timeout:45000});
 await governed.getByText(/Discovered tools/).click();await expect(governed.getByLabel('governed MCP connection result')).toContainText('search');
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('No discovered tool was executed');
 await page.reload({waitUntil:'domcontentloaded'});await expect(governed.getByLabel('governed MCP connection result')).toContainText('CONNECTED');
 await go(page,'admin',false);const access=page.getByRole('region',{name:'MCP permissions'});
 await access.getByRole('button',{name:'Change Docs Preview access'}).click();await access.getByRole('textbox',{name:'Reason to change Docs Preview access'}).fill('Block this documentation endpoint after verification.');
 await access.getByRole('button',{name:'Review block'}).click();await access.getByRole('button',{name:'Save MCP access'}).click();
 await expect(access.getByRole('button',{name:'Change Docs Preview access'})).toBeVisible();
 await go(page,'workspace');await prompt.fill('Connect with Docs Preview MCP');await governed.getByRole('button',{name:'Send message'}).click();
 await expect(governed.getByLabel('governed MCP connection result')).toContainText('BLOCKED');await expect(governed.getByLabel('governed MCP connection result')).toContainText('No connection attempted');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('greetings render a conversational reply on either side without creating tool activity',async({page})=>{
 await page.goto('/workspace',{waitUntil:'domcontentloaded'});
 const panels=[page.getByRole('region',{name:'Without Precedent conversation',exact:true}),page.getByRole('region',{name:'With Precedent conversation',exact:true})];
 for(const [index,panel] of panels.entries()){
  await panel.getByRole('textbox',{name:index?'Message with Precedent':'Message without Precedent',exact:true}).fill('hellow\nhello');
  await panel.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(panel.locator('.agent-message')).toContainText('Hello! What would you like help with?');
  await expect(panel.locator('.agent-message')).toContainText('No tools used');await expect(panel.locator('.tool-message')).toHaveCount(0);
  await expect(panel.getByText('Inspect proposed plan',{exact:false})).toHaveCount(0);await expect(panel.getByRole('button',{name:'Run this action again'})).toHaveCount(0);
 }
 await page.reload({waitUntil:'domcontentloaded'});
 for(const panel of panels){await expect(panel.locator('.agent-message')).toContainText('Hello! What would you like help with?');await expect(panel.locator('.tool-message')).toHaveCount(0);}
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'.data/conversation-greeting-browser.png',fullPage:true});
});

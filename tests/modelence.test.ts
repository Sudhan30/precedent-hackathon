import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';import {MongoClient} from 'mongodb';
import {withDatabase} from '../packages/database/uri.js';
test('Modelence HTTP lifecycle, assigned roles, login and persistent session ownership',{skip:!process.env.TEST_MONGODB_URI,timeout:180000},async()=>{
 const uri=withDatabase(process.env.TEST_MONGODB_URI!,'pv_auth_'+crypto.randomUUID().replaceAll('-','').slice(0,16));
 const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));const base=`http://127.0.0.1:${port}`;
 let child:ChildProcess|undefined;const client=new MongoClient(uri);await client.connect();
 const start=async()=>{child=spawn(process.execPath,['--import','tsx','apps/server/main.ts'],{env:{...process.env,MONGODB_URI:uri,PORT:String(port),MODELENCE_PORT:String(port),MODELENCE_SITE_URL:base,MODELENCE_TRACKING_ENABLED:'false',MODELENCE_SERVICE_TOKEN:'',AUTH_MODE:'modelence',PRECEDENT_LOGIN_ALIASES:JSON.stringify({admin:email}),CONNECTOR_DB:':memory:',VOYAGE_API_KEY:'',EVE_WORKER_URL:''},stdio:['ignore','pipe','pipe']});await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Modelence startup timeout')),60000);child!.stdout!.on('data',data=>{if(String(data).includes('Application started on')){clearTimeout(timer);resolve();}});child!.once('exit',code=>{clearTimeout(timer);reject(new Error('Modelence startup exited: '+code));});});};
 const stop=async()=>{if(!child||child.exitCode!==null)return;const exited=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill('SIGTERM');await exited;};
 const email=`modelence-${crypto.randomUUID()}@example.com`,password=crypto.randomUUID()+'Aa!';let cookie='';
 const call=async(path:string,body?:unknown,useCookie=true)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(useCookie&&cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const next=response.headers.getSetCookie().find(value=>value.startsWith('authToken='));if(next&&useCookie)cookie=next.split(';')[0];return response;};
 try{
  await start();assert.deepEqual((await(await call('/api/config')).json() as any).loginAliases,{admin:email});assert.equal((await call('/api/state')).status,401);assert.equal((await call('/api/login',{role:'admin'})).status,403);
  assert.equal((await call('/api/_internal/method/_system.user.signupWithPassword',{args:{email,password}})).status,200);assert.equal((await call('/api/_internal/method/_system.user.loginWithPassword',{args:{email,password}})).status,200);assert.ok(cookie);assert.equal((await call('/api/me')).status,403);
  const users=client.db().collection('_modelenceUsers');const result=await users.updateOne({'emails.address':email},{$addToSet:{roles:'employee'}});assert.equal(result.matchedCount,1);
  const me=await (await call('/api/me')).json() as any;assert.equal(me.role,'employee');
  const session=await (await call('/api/sessions',{})).json() as any;assert.equal(session.principalId,me.userId);
  const request={sessionId:session.id,toolId:'internal_logs.search',resourceId:'customer-logs',environment:'production',executionId:crypto.randomUUID()};assert.equal((await call('/api/actions',request)).status,200);
  const state=await (await call('/api/state')).json() as any;assert.equal((await call('/api/policy',{expectedVersion:state.policy.version,sandboxAllowed:false})).status,403);
  await users.updateOne({'emails.address':email},{$addToSet:{roles:'admin'}});assert.equal((await (await call('/api/me')).json() as any).role,'admin');
  const published=await (await call('/api/policy',{expectedVersion:state.policy.version,sandboxAllowed:false})).json() as any;assert.equal(published.publishedBy,me.userId);
  await stop();await start();assert.equal((await call('/api/actions',{...request,executionId:crypto.randomUUID()})).status,200);
  assert.equal((await call('/api/_internal/method/_system.user.logout',{args:{}})).status,200);assert.equal((await call('/api/me')).status,401);
  assert.equal((await call('/api/_internal/method/_system.user.loginWithPassword',{args:{email,password}})).status,200);assert.equal((await call('/api/me')).status,200);
  const setup=spawn(process.execPath,['--import','tsx','scripts/setup-user.ts'],{env:{...process.env,MONGODB_URI:uri,MODELENCE_SITE_URL:base,PRECEDENT_SETUP_EMAIL:email,PRECEDENT_SETUP_PASSWORD:password,PRECEDENT_SETUP_ROLE:'employee'},stdio:'ignore'});
  assert.equal(await new Promise<number|null>(resolve=>setup.once('exit',resolve)),0);
  const setupEmail=`setup-${crypto.randomUUID()}@example.com`;
  const create=spawn(process.execPath,['--import','tsx','scripts/setup-user.ts'],{env:{...process.env,MONGODB_URI:uri,MODELENCE_SITE_URL:'https://precedent.example.com',PRECEDENT_SETUP_URL:base,PRECEDENT_SETUP_EMAIL:setupEmail,PRECEDENT_SETUP_PASSWORD:crypto.randomUUID()+'Aa!',PRECEDENT_SETUP_ROLE:'employee'},stdio:'ignore'});
  assert.equal(await new Promise<number|null>(resolve=>create.once('exit',resolve)),0);assert.ok((await users.findOne({'emails.address':setupEmail}))?.roles.includes('employee'));
  if(process.env.TEST_MODELENCE_BROWSER==='true'){
   const {chromium}=await import('@playwright/test');const browser=await chromium.launch({channel:'chromium'});
   try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+'/login');await page.getByLabel('Username or email').waitFor();await page.screenshot({path:'.data/login-desktop.png',fullPage:true});
    await page.getByLabel('Username or email').fill('admin');await page.getByLabel('Password',{exact:true}).fill('Incorrect-password-for-test');await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text');await page.getByRole('button',{name:'Hide password',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/Unable to sign in/);
    await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('textbox',{name:'Message with Precedent',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/workspace');assert.equal(await page.locator('[role="alert"]').count(),0);
    await page.getByRole('textbox',{name:'Message with Precedent',exact:true}).fill('Private unsent draft');await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByLabel('Username or email').waitFor();assert.equal(new URL(page.url()).pathname,'/login');assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:'.data/login-mobile.png',fullPage:true});
    await page.getByLabel('Username or email').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('textbox',{name:'Message with Precedent',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message with Precedent',exact:true}).inputValue(),'');await page.reload();await page.getByRole('textbox',{name:'Message with Precedent',exact:true}).waitFor();
   }
   finally{await browser.close();}
  }
 }finally{await stop();await client.close();}
});

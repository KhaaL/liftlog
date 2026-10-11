// Browser checks for the recovery controls; only synthetic state/fake S3.
const assert = require('node:assert/strict');
const {appWithTestAPI,launchBrowser}=require('./harness.cjs');
const html=appWithTestAPI(`{prepareBackup,applyFullBackup,navigate,remoteSyncPaused,get state(){return state},get ui(){return ui}}`);
const fixture=(revision,notes)=>({version:14,settings:{lastModifiedAt:revision},exercises:[{id:'e',name:'Squat',unit:'kg'}],routines:[],workouts:[{id:'w',startedAt:1,finishedAt:2,notes,exercises:[{exerciseId:'e',name:'Squat',unit:'kg',sets:[{id:'s',reps:5,weight:20,completed:true}]}]}],activeWorkout:null});
const cfg={endpoint:'https://storage.test',region:'test',bucket:'test',pathStyle:true,objectKey:'backup.json',accessKeyId:'fake',secretAccessKey:'fake'};
(async()=>{
 const browser=await launchBrowser();const errors=[];
 try {
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
 await context.route('**/*',route=>route.request().url().startsWith('https://liftlog.test/')?route.fulfill({contentType:'text/html',body:html}):route.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({state,cfg})=>{if(!localStorage.getItem('liftlog.v1')){
  localStorage.setItem('liftlog.v1',JSON.stringify(state));localStorage.setItem('liftlog.v1.remote',JSON.stringify(cfg));localStorage.setItem('liftlog.v1.remote-paused','{}');
 }},{state:fixture(300,'before'),cfg});
 const fake=async(cloud)=>page.evaluate(cloud=>{
  window.fakeS3={cloud,etag:'"1"',calls:[],snapshots:[]};
  window.fetch=async(url,o)=>{const s=window.fakeS3;s.calls.push({method:o.method,headers:o.headers,url});
   if(o.method==='GET')return new Response(JSON.stringify(s.cloud),{headers:{etag:s.etag}});
   if(url.includes('.snapshots/')){s.snapshots.push(JSON.parse(o.body));return new Response('');}
   if(o.headers['if-match']!==s.etag)return new Response('',{status:412});
   s.cloud=JSON.parse(o.body);s.etag='"2"';return new Response('');
  };
 },cloud);
 await page.goto('https://liftlog.test/');await fake(fixture(Date.now()+100000,'cloud'));
 await page.evaluate(()=>window.testAPI.navigate('settings'));
 await page.evaluate(value=>{window.testAPI.applyFullBackup(value);},fixture(100,'chosen local'));
 await page.getByRole('button',{name:'Import & replace',exact:true}).click();
 await page.waitForFunction(()=>window.testAPI.state.workouts[0].notes==='chosen local');
 assert.equal(await page.evaluate(()=>window.testAPI.remoteSyncPaused()),true);
 assert.match(await page.locator('#remote-status').textContent(),/paused/);
 assert.equal(await page.locator('[data-action="remote-backup"]').count(),0);
 assert.equal(await page.locator('[data-action="remote-publish-local"]').count(),1);
 await page.reload();await fake(fixture(Date.now()+100000,'cloud'));await page.evaluate(()=>window.testAPI.navigate('settings'));
 assert.equal(await page.evaluate(()=>window.testAPI.state.workouts[0].notes),'chosen local');
 await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
 assert.equal(await page.evaluate(()=>window.fakeS3.calls.length),0);
 console.log('PASS local recovery and pause controls persist through reload and online recovery');
 await page.locator('details[data-settings-section="storage"] > summary').click();
 await page.locator('[data-action="remote-resume"]').click();
 // A newer cloud must be explained, and cancellation leaves the chosen local data.
 await page.getByRole('button',{name:'Use cloud copy & resume',exact:true}).waitFor();
 assert.match(await page.locator('dialog[open]').textContent(),/cloud copy will replace/i);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.waitForFunction(()=>!window.testAPI.ui.remoteBusy);
 assert.equal(await page.evaluate(()=>window.testAPI.state.workouts[0].notes),'chosen local');
 assert.equal(await page.evaluate(()=>window.testAPI.remoteSyncPaused()),true);
 console.log('PASS reviewed resume warns before cloud replacement; cancellation preserves local recovery');
 await page.locator('[data-action="remote-publish-local"]').click();
 await page.getByRole('button',{name:'Keep local & update cloud',exact:true}).click();
 await page.waitForFunction(()=>!window.testAPI.ui.remoteBusy);
 assert.equal(await page.evaluate(()=>window.fakeS3.cloud.workouts[0].notes),'chosen local');
 assert.equal(await page.evaluate(()=>window.fakeS3.snapshots[0].workouts[0].notes),'cloud');
 assert.equal(await page.evaluate(()=>window.testAPI.remoteSyncPaused()),false);
 assert.equal(await page.locator('[data-action="remote-pause"]').count(),1);
 await page.locator('[data-action="remote-pause"]').click();
 assert.equal(await page.evaluate(()=>window.testAPI.remoteSyncPaused()),true);
 assert.equal(await page.locator('[data-action="remote-resume"]').count(),1);
 assert.ok(await page.evaluate(()=>!!JSON.parse(localStorage.getItem('liftlog.v1.remote')).secretAccessKey));
 console.log('PASS explicit local publication uses snapshots; pause retains credentials and exposes reviewed choices');
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS no browser errors in recovery flows');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

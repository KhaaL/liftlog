const assert = require('node:assert/strict');
const {device} = require('./remote-harness.cjs');
const cfg = {endpoint:'https://storage.test',region:'test',bucket:'test',objectKey:'backup.json',pathStyle:true,accessKeyId:'fake',secretAccessKey:'synthetic-secret'};
const copy = v => JSON.parse(JSON.stringify(v));
const fixture = (revision=100,notes='base') => ({version:14, settings:{lastModifiedAt:revision},exercises:[{id:'e',name:'Squat',unit:'kg'}],routines:[],workouts:[{id:'w',startedAt:1,finishedAt:2,notes,exercises:[{exerciseId:'e',name:'Squat',unit:'kg',sets:[{id:'s',reps:5,weight:20,completed:true}]}]}],activeWorkout:null});
function setup(revision=100,notes='base',storage){const d=device(storage);d.api.state=d.api.prepareBackup(fixture(revision,notes));d.api.existing=true;d.api.saveRemoteConfig(copy(cfg));d.api.flushSave();return d;}
const gate = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const until = async fn => {for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r, 2));}throw Error('Did not reach test barrier');};
class S3 {
  constructor(obj){this.obj=obj&&copy(obj);this.etag='"1"';this.calls=[];this.snapshots=[];this.afterGet=null;this.beforePut=null;}
  attach(d){d.ctx.fetch=async(url,options)=>{
    const req={url, ...options};this.calls.push(req);
    if(options.method==='GET'){
      const res=this.obj ? new Response(JSON.stringify(this.obj),{headers:{etag:this.etag}}) : new Response('<Error><Code>NoSuchKey</Code></Error>',{status:404});
      if(this.afterGet)await this.afterGet(req);return res;
    }
    assert.equal(options.headers['if-none-match'] === '*' || !!options.headers['if-match'],true,'ALL writes conditional');
    if(url.includes('.snapshots/')){this.snapshots.push(JSON.parse(options.body));return new Response('');}
    if(this.beforePut)await this.beforePut(req);
    if(options.headers['if-match'] && options.headers['if-match']!==this.etag || options.headers['if-none-match']==='*' && this.obj) return new Response('',{status:412});
    this.obj=JSON.parse(options.body);this.etag='"'+(Number(this.etag.replaceAll('"',''))+1)+'"';return new Response('');
  };}
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
await test('two devices: conditional CAS collision rereads and preserves both prior revisions',async()=>{
 const a=setup(200,'A'),b=setup(300,'B'),s=new S3(fixture());s.attach(a);s.attach(b);
 let reads=0;const g=gate();s.afterGet=async()=>{if(++reads===2)g.resolve();if(reads<=2)await g.promise;};
 await Promise.all([a.api.remoteBackup(),b.api.remoteBackup()]);
 assert.equal(s.obj.settings.lastModifiedAt,300);assert.equal(s.obj.workouts[0].notes,'B');assert.ok(s.snapshots.length>=2);
 assert.ok(s.calls.filter(x=>x.method==='GET').length>=3);
 assert.ok(s.snapshots.some(x=>x.workouts[0].notes==='base'));
});
await test('stale device cannot overwrite a newer cloud state; local rescue survives',async()=>{
 const d=setup(100,'stale'),s=new S3(fixture(200,'new'));s.attach(d);await d.api.remoteBackup();
 assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);assert.equal(d.api.state.workouts[0].notes,'new');assert.equal(JSON.parse(d.api.rescue).workouts[0].notes,'stale');
});
await test('GET races: starting a workout or editing notes prevents replacement',async()=>{
 for(const active of [false,true]){const d=setup(),s=new S3(fixture(500,'cloud'));s.attach(d);const g=gate();s.afterGet=()=>g.promise;
 const work=d.api.remoteStartupSync();await until(()=>s.calls.length);
 if(active){d.api.state.activeWorkout={...copy(d.api.state.workouts[0]),id:'active',finishedAt:null};}
 else d.api.state.workouts[0].notes='during GET';d.api.save();g.resolve();await work;
 assert.ok(d.api.state.activeWorkout || d.api.state.workouts[0].notes==='during GET');assert.equal(s.calls.length,1);
 assert.equal(d.api.ui.remoteStatus,'pending');}
});
await test('active/recoverable workouts protected at startup, online recovery and after reload',async()=>{
 const d=setup(),s=new S3(fixture(500));s.attach(d);d.api.state.activeWorkout={...copy(d.api.state.workouts[0]),id:'active',finishedAt:null};d.api.save({immediate:true});
 for(let i=0;i<2;i++)await d.api.remoteStartupSync();assert.equal(d.api.state.activeWorkout.id,'active');
 const re=device(d.storage);s.attach(re);await re.api.remoteStartupSync();assert.equal(re.api.state.activeWorkout.id,'active');
 d.api.state.workouts[0].notes='finished local';d.api.state.activeWorkout=null;d.api.save();await d.api.remoteBackup();assert.equal(s.obj.workouts[0].notes,'finished local');
});
await test('equal timestamps compare normalized contents and exclude export bookkeeping',async()=>{
 const d=setup(),s=new S3(fixture());s.obj.exportedAt='2020-01-01';s.obj.settings.lastFileBackupAt=999;s.attach(d);
 await d.api.remoteStartupSync();assert.equal(d.api.ui.remoteStatus,'synced');
 s.obj.workouts[0].notes='different';await d.api.remoteBackup();assert.equal(d.api.ui.remoteStatus,'conflict');assert.equal(d.api.state.workouts[0].notes,'base');assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);
 const old=fixture();old.version=11;assert.equal(d.api.backupDataKey(old),d.api.backupDataKey(fixture()));
});
await test('undated legacy backups require explicit selection when data differs',async()=>{
 const d=setup(),old=fixture(null,'legacy');delete old.settings.lastModifiedAt;old.exportedAt=new Date().toISOString();const s=new S3(old);s.attach(d);await d.api.remoteBackup();assert.equal(d.api.ui.remoteStatus,'conflict');assert.equal(s.calls.length,1);
 await d.api.remoteRestore();assert.equal(d.api.state.workouts[0].notes,'legacy');
});
await test('clock rollback and same-millisecond edits produce monotonic revisions; file export bookkeeping does not',async()=>{
 const d=setup(9999999999999);d.api.save();const one=d.api.state.settings.lastModifiedAt;d.api.save();assert.equal(d.api.state.settings.lastModifiedAt,one+1);
 d.api.save({touch:false,remote:false});assert.equal(d.api.state.settings.lastModifiedAt,one+1);
});
await test('edits during upload remain durable pending work and do not report up to date',async()=>{
 const d=setup(200,'local'),s=new S3(fixture());s.attach(d);const g=gate();s.beforePut=()=>g.promise;
 const work=d.api.remoteBackup();await until(()=>s.calls.some(x=>x.method==='PUT'&&!x.url.includes('.snapshots/')));
 d.api.state.workouts[0].notes='new edit';d.api.save();g.resolve();await work;
 assert.equal(d.api.readRemoteWork().pending,true);assert.equal(d.api.ui.remoteStatus,'pending');assert.equal(JSON.parse(d.storage.get('liftlog.v1.remote')).lastUploadedModifiedAt,200);
 const re=device(d.storage);assert.equal(re.api.readRemoteWork().pending,true);
});
await test('network failures persist bounded retry, reload recovery and immediate manual retry',async()=>{
 const d=setup(200);d.ctx.fetch=async()=>{throw Error('offline failure');};await d.api.autoRemoteBackup();let w=d.api.readRemoteWork();assert.equal(w.pending,true);assert.equal(w.attempts,1);
 for(let i=0;i<12;i++)await d.api.autoRemoteBackup();w=d.api.readRemoteWork();assert.equal(w.attempts,10);assert.ok(w.nextAt-Date.now()<=300000);
 const re=device(d.storage),s=new S3();s.attach(re);await re.api.remoteStartupSync();assert.equal(re.api.readRemoteWork().pending,true);await re.api.remoteBackup();assert.equal(re.api.readRemoteWork().pending,false);
});
await test('request and streamed body timeouts abort and persist retry',async()=>{
 for(const body of [false,true]){const d=setup();let signal;
 d.ctx.fetch=async(url,o)=>{signal=o.signal;if(!body)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))));
 return {ok:true,status:200,headers:new Headers({etag:'"x"'}),body:{getReader:()=>({read:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))))})}};};
 const p=d.api.autoRemoteBackup();await until(()=>signal&&[...d.timers.values()].some(t=>t.delay===20000));[...d.timers.values()].find(t=>t.delay===20000).fn();await p;
 assert.equal(signal.aborted,true);assert.match(d.api.ui.remoteStatusText,/timed out/);assert.equal(d.api.readRemoteWork().pending,true);}
});
await test('forget/change abort old GET/PUT/config check and cannot resurrect credentials or restore',async()=>{
 for(const op of ['check','upload','config']){const d=setup(200,'local'),s=new S3(op==='upload'?fixture():fixture(500,'remote'));s.attach(d);const g=gate();
 if(op==='upload')s.beforePut=()=>g.promise;else s.afterGet=()=>g.promise;
 const p=op==='config'?d.api.testAndSaveRemoteConfig({...cfg,bucket:'other'}):op==='upload'?d.api.remoteBackup():d.api.remoteStartupSync();
 await until(()=>s.calls.some(x=>op==='upload'?x.method==='PUT'&&!x.url.includes('.snapshots/'):x.method==='GET'));
 const controllers=[...d.api.controllers];d.api.clearRemoteConfig();assert.ok(controllers.every(c=>c.signal.aborted));g.resolve();await p;
 assert.equal(d.storage.has('liftlog.v1.remote'),false);assert.equal(d.api.state.workouts[0].notes,'local');assert.equal(d.api.ui.remoteStatus,'');}
 const d=setup(),s=new S3(fixture(500,'remote'));s.attach(d);const g=gate();s.afterGet=()=>g.promise;const p=d.api.remoteStartupSync();await until(()=>s.calls.length);d.api.saveRemoteConfig({...cfg,bucket:'changed'});g.resolve();await p;assert.equal(JSON.parse(d.storage.get('liftlog.v1.remote')).bucket,'changed');assert.equal(d.api.state.workouts[0].notes,'base');
});
await test('one coordinator serializes restore, upload and connection checks',async()=>{
 const d=setup(),s=new S3(fixture());s.attach(d);const g=gate();s.afterGet=()=>g.promise;
 const first=d.api.remoteStartupSync();await until(()=>s.calls.length);const second=d.api.remoteTestConnection();await new Promise(r=>setTimeout(r, 2));assert.equal(s.calls.length,1);g.resolve();await Promise.all([first,second]);assert.equal(s.calls.length,2);
});
await test('malformed/oversized data, count limits, missing ETag and NoSuchBucket preserve local/cloud data',async()=>{
 const cases=[new Response('{bad',{headers:{etag:'"x"'}}),new Response(JSON.stringify({version:14}),{headers:{etag:'"x"'}}),new Response(JSON.stringify(fixture())),new Response('<Error><Code>NoSuchBucket</Code></Error>',{status:404}),new Response('',{status:404}),new Response('x',{headers:{'content-length':9*1024*1024}}),new Response('x'.repeat(8*1024*1024+1))];
 for(const response of cases){const d=setup();const before=JSON.stringify(d.api.state);let puts=0;d.ctx.fetch=async(url,o)=>{if(o.method==='PUT')puts++;return response;};await d.api.remoteBackup();assert.equal(JSON.stringify(d.api.state),before);assert.equal(puts,0);assert.equal(d.api.ui.remoteStatus,'error');}
 const d=setup();const huge=fixture();huge.workouts[0].notes='x'.repeat(8*1024*1024);assert.throws(()=>d.api.prepareBackup(huge),/8 MiB/);
 const count=fixture();count.extra=Array(200001).fill(1);assert.throws(()=>d.api.prepareBackup(count),/limits/);
 d.api.state.workouts[0].notes='x'.repeat(8*1024*1024);const s=new S3();s.attach(d);await d.api.remoteBackup();assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);
});
await test('local quota failure: remote and file restores retain old usable state and recovery copy',async()=>{
 for(const file of [false,true]){const d=setup(),s=new S3(fixture(500,'remote'));s.attach(d);d.api.save({touch:false,remote:false,immediate:true});const before=JSON.stringify(d.api.state),durable=d.storage.get('liftlog.v1');const set=d.ctx.localStorage.setItem;d.ctx.localStorage.setItem=(k,v)=>{if(k==='liftlog.v1')throw Error('quota');return set(k,v);};
 if(file)await d.api.applyFullBackup(fixture(500,'file'));else await d.api.remoteStartupSync();
 assert.equal(JSON.stringify(d.api.state),before);assert.equal(d.storage.get('liftlog.v1'),durable);assert.equal(d.api.saveFailed,true);assert.equal(JSON.parse(d.api.rescue).workouts[0].notes,'base');}
});
await test('successful cloud backup distinguishes failed local save and keeps warning',async()=>{
 const d=setup(200,'local'),s=new S3(fixture());s.attach(d);d.api.save({remote:false});const set=d.ctx.localStorage.setItem;d.ctx.localStorage.setItem=(k,v)=>{if(k==='liftlog.v1')throw Error('quota');return set(k,v);};await d.api.remoteBackup();assert.equal(s.obj.settings.lastModifiedAt,d.api.state.settings.lastModifiedAt);
 assert.equal(d.api.saveFailed,true);assert.match(d.api.ui.remoteStatusText,/local saving failed/);assert.equal(d.api.readRemoteWork().pending,false);
});
await test('existing backups and recovery copy roundtrip; credentials excluded',async()=>{
 const d=setup();for(const version of [8,11,13,14]){const legacy=fixture();legacy.version=version;assert.equal(d.api.prepareBackup(legacy).version,14);}
 const before=d.api.backupDataKey(d.api.state);assert.equal(d.api.commitSnapshot(d.api.prepareBackup(fixture(500,'other'))),true);const rescued=d.api.prepareBackup(JSON.parse(d.api.rescue));assert.equal(d.api.backupDataKey(rescued),before);assert.equal(d.api.commitSnapshot(rescued),true);
 assert.equal(JSON.stringify(d.api.backupPayload()).includes(cfg.secretAccessKey),false);
});
await test('destination validation rejects unsafe endpoints and paths; R2 requires account/path/auto',async()=>{
 const d=setup();for(const patch of [{endpoint:'https://user:pass@storage.test'},{endpoint:'https://storage.test?q=a'},{endpoint:'https://storage.test#x'},{endpoint:'https://storage.test/../'},{endpoint:'http://storage.test'},{bucket:'bad/bucket'},{objectKey:'a/../b'},{objectKey:'a/%2e%2e/b'},{pathStyle:'yes'},{region:'bad/region'}])assert.throws(()=>d.api.validateRemoteConfig({...cfg,...patch}));
 const r2={...cfg,endpoint:'https://'+'a'.repeat(32)+'.r2.cloudflarestorage.com',region:'auto'};assert.doesNotThrow(()=>d.api.validateRemoteConfig(r2));assert.throws(()=>d.api.validateRemoteConfig({...r2,pathStyle:false}));
});
await test('409 retries reread and snapshot failure never updates current object',async()=>{
 const d=setup(200,'local'),s=new S3(fixture());s.attach(d);const fetch=d.ctx.fetch;let once=true;
 d.ctx.fetch=async(u,o)=>{if(o.method==='PUT'&&!u.includes('.snapshots/')&&once){once=false;return new Response('',{status:409});}return fetch(u,o);};
 await d.api.remoteBackup();assert.equal(s.calls.filter(x=>x.method==='GET').length,2);assert.equal(s.obj.workouts[0].notes,'local');
 const fail=setup(200,'local'),server=new S3(fixture());server.attach(fail);const real=fail.ctx.fetch;
 fail.ctx.fetch=(u,o)=>u.includes('.snapshots/')?new Response('',{status:403}):real(u,o);await fail.api.remoteBackup();
 assert.equal(server.obj.workouts[0].notes,'base');assert.equal(server.calls.filter(x=>x.method==='PUT').length,0);
});
await test('recovery download contains exact previous backup; oversized files rejected before reading',async()=>{
 const d=setup();d.api.commitSnapshot(d.api.prepareBackup(fixture(500,'other')));let downloaded;
 d.api.download=(blob)=>{downloaded=blob;};d.api.actions['remote-rescue-download']();
 assert.equal(await downloaded.text(),d.api.rescue);assert.equal(d.api.prepareBackup(JSON.parse(await downloaded.text())).workouts[0].notes,'base');
 d.api.readJSONFile({size:9*1024*1024},()=>{throw Error('must not read');});assert.match(d.messages.at(-1),/exceeds 8 MiB/);
 const huge=d.api.backupPayload();huge.workouts[0].notes='x'.repeat(8*1024*1024);d.storage.set('liftlog.v1',JSON.stringify(huge));const re=device(d.storage);assert.equal(re.api.state.workouts[0].notes.length,8*1024*1024);assert.equal(re.storage.has('liftlog.v1.unreadable'),false);
});
await test('manual remote/file confirmations cannot discard edits or ignore configuration invalidation',async()=>{
 for(const file of [false,true]){const d=setup(),s=new S3(fixture(500,'remote'));s.attach(d);const g=gate();let waiting=false;d.api.confirm=()=>{waiting=true;return g.promise;};
 const p=file?d.api.applyFullBackup(fixture(500,'file')):d.api.remoteRestore();await until(()=>waiting);d.api.state.workouts[0].notes='new note';d.api.save();g.resolve(true);await p;assert.equal(d.api.state.workouts[0].notes,'new note');}
 const d=setup();const g=gate();let waiting=false;d.api.confirm=()=>{waiting=true;return g.promise;};const p=d.api.applyFullBackup(fixture(500,'file'));await until(()=>waiting);d.api.clearRemoteConfig();g.resolve(true);await p;assert.equal(d.api.state.workouts[0].notes,'base');
});
await test('GET connection check never claims write permission, and PUT requires conditions',async()=>{
 const d=setup(),s=new S3(fixture());s.attach(d);await d.api.remoteTestConnection();assert.match(d.messages.at(-1),/write permission unverified/);assert.equal(s.calls.length,1);
 await assert.rejects(d.api.s3Request(cfg,'PUT','{}'),/Unconditional/);
});
await test('older local recovery survives auto backup/startup/online/reload with credentials retained',async()=>{
 const d=setup(300,'before import'),s=new S3(fixture(Date.now()+100000,'cloud'));s.attach(d);
 await d.api.applyFullBackup(fixture(100,'chosen file'));
 assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.workouts[0].notes,'chosen file');
 assert.ok(d.api.state.settings.lastModifiedAt>=300+1);assert.equal(d.api.readRemoteWork().pending,true);
 await d.api.autoRemoteBackup();await d.api.remoteStartupSync();await d.api.remoteBackup();assert.equal(s.calls.length,0);
 const re=device(d.storage);s.attach(re);await re.api.remoteStartupSync();await re.api.autoRemoteBackup();assert.equal(s.calls.length,0);
 assert.equal(re.api.state.workouts[0].notes,'chosen file');assert.equal(JSON.parse(re.storage.get('liftlog.v1.remote')).secretAccessKey,cfg.secretAccessKey);
 assert.match(re.api.remoteStorageHTML(),/Keep local copy &amp; update cloud|Keep local copy & update cloud/);
});
await test('pause aborts pending GET and invalidates queued operations; local restore wins',async()=>{
 const d=setup(300,'before'),s=new S3(fixture(500,'cloud'));s.attach(d);const g=gate();s.afterGet=()=>g.promise;
 const first=d.api.remoteStartupSync();await until(()=>s.calls.length);const queued=d.api.autoRemoteBackup();const controllers=[...d.api.controllers];
 const restore=d.api.applyFullBackup(fixture(100,'recovered'));assert.equal(d.api.remoteSyncPaused(),true);assert.ok(controllers.every(c=>c.signal.aborted));
 g.resolve();await Promise.all([first,queued,restore]);assert.equal(d.api.state.workouts[0].notes,'recovered');assert.equal(s.calls.length,1);
});
await test('pause stops upload follow-ups and obsolete success after a dispatched PUT',async()=>{
 const d=setup(300,'local'),s=new S3(fixture(100,'cloud'));s.attach(d);const g=gate();s.beforePut=()=>g.promise;
 const job=d.api.remoteBackup();await until(()=>s.calls.some(x=>x.method==='PUT'&&!x.url.includes('.snapshots/')));
 d.api.pauseRemoteSync('Paused by user');g.resolve();await job;
 assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.workouts[0].notes,'local');assert.equal(JSON.parse(d.storage.get('liftlog.v1.remote')).lastUploadedModifiedAt,undefined);
 assert.equal(d.api.ui.remoteStatus,'paused');assert.equal(d.api.controllers.size,0);
});
await test('cancelled and failed local restores stay paused; inability to persist pause blocks replacement',async()=>{
 const d=setup();d.api.confirm=async()=>false;await d.api.applyFullBackup(fixture(500,'file'));assert.equal(d.api.state.workouts[0].notes,'base');assert.equal(d.api.remoteSyncPaused(),true);
 const fail=setup();const original=fail.ctx.localStorage.setItem;fail.ctx.localStorage.setItem=(k,v)=>{if(k==='liftlog.v1.remote-paused')throw Error('quota');return original(k,v);};
 await fail.api.applyFullBackup(fixture(500,'file'));assert.equal(fail.api.state.workouts[0].notes,'base');assert.equal(fail.api.remoteSyncPaused(),true);assert.match(fail.messages.at(-1),/persist cloud sync pause/);
 const s=new S3(fixture(500,'cloud'));s.attach(fail);await fail.api.remoteStartupSync();assert.equal(s.calls.length,0);
});
await test('restoring identical normalized data does not manufacture a revision',async()=>{
 const d=setup(300),payload=d.api.backupPayload();payload.exportedAt='2020-01-01';payload.settings.lastFileBackupAt=123;
 await d.api.applyFullBackup(payload);assert.equal(d.api.state.settings.lastModifiedAt,300);assert.equal(d.api.remoteSyncPaused(),true);
});
await test('explicit publication supersedes a newer cloud revision and preserves its snapshot',async()=>{
 const future=Date.now()+100000,d=setup(100,'chosen local'),s=new S3(fixture(future,'cloud'));s.attach(d);d.api.pauseRemoteSync();
 await d.api.remotePublishLocal();assert.equal(s.obj.workouts[0].notes,'chosen local');assert.equal(s.obj.settings.lastModifiedAt,future+1);assert.equal(d.api.state.settings.lastModifiedAt,future+1);
 assert.equal(s.snapshots.length,1);assert.equal(s.snapshots[0].workouts[0].notes,'cloud');assert.equal(d.api.remoteSyncPaused(),false);assert.equal(d.api.readRemoteWork().pending,false);
 assert.equal(s.calls.filter(x=>x.method==='GET').length,2);assert.equal(s.calls.find(x=>x.method==='PUT'&&!x.url.includes('.snapshots/')).headers['if-match'],'"1"');
});
await test('explicit publication creates missing object conditionally; identical copies need no PUT',async()=>{
 const d=setup(100,'local'),s=new S3();s.attach(d);d.api.pauseRemoteSync();await d.api.remotePublishLocal();
 assert.equal(s.obj.workouts[0].notes,'local');assert.equal(s.calls.find(x=>x.method==='PUT').headers['if-none-match'],'*');assert.equal(d.api.remoteSyncPaused(),false);
 const same=setup(100),server=new S3(fixture(200));server.attach(same);same.api.pauseRemoteSync();await same.api.remotePublishLocal();assert.equal(server.calls.filter(x=>x.method==='PUT').length,0);assert.equal(same.api.state.settings.lastModifiedAt,100);assert.equal(same.api.remoteSyncPaused(),false);
});
await test('cloud changed after review stays paused and requires a fresh choice',async()=>{
 for(const mode of ['local','cloud','automatic']){const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);d.api.pauseRemoteSync();
 d.api.confirm=async()=>{s.obj=fixture(300,'new cloud');s.etag='"2"';return true;};
 await (mode==='local'?d.api.remotePublishLocal():mode==='cloud'?d.api.remoteRestore():d.api.remoteResumeSync());
 assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.workouts[0].notes,'local');assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);assert.match(d.api.ui.remoteStatusText,/Cloud changed since review/);}
});
await test('409/412 publication conflicts reread without restoring or retrying PUT automatically',async()=>{
 for(const status of [409,412]){const d=setup(100,'chosen'),s=new S3(fixture(200,'cloud'));s.attach(d);const real=d.ctx.fetch;let puts=0;
 d.ctx.fetch=async(u,o)=>{if(o.method==='PUT'&&!u.includes('.snapshots/')){puts++;s.obj=fixture(Date.now()+200000,'concurrent cloud');s.etag='"2"';return new Response('',{status});}return real(u,o);};
 await d.api.remotePublishLocal();assert.equal(puts,1);assert.equal(s.calls.filter(x=>x.method==='GET').length,3);assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.workouts[0].notes,'chosen');assert.equal(s.obj.workouts[0].notes,'concurrent cloud');
 await d.api.remoteStartupSync();await d.api.autoRemoteBackup();assert.equal(puts,1);assert.match(d.api.ui.remoteStatusText,/paused/);}
});
await test('review cancellation and local edits during either GET/confirmation preserve pause',async()=>{
 for(const stage of ['cancel','review GET','confirm','second GET']){const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);let reads=0;
 s.afterGet=async()=>{reads++;if(stage==='review GET'&&reads===1||stage==='second GET'&&reads===2){d.api.state.workouts[0].notes='edited';d.api.save();}};
 d.api.confirm=async()=>{if(stage==='confirm'){d.api.state.workouts[0].notes='edited';d.api.save();}return stage!=='cancel';};
 await d.api.remotePublishLocal();assert.equal(d.api.remoteSyncPaused(),true);assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);assert.equal(d.api.state.workouts[0].notes,stage==='cancel'?'local':'edited');}
});
await test('active workout blocks cloud choice/reviewed resume; it remains intact on explicit local publication',async()=>{
 const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);d.api.state.activeWorkout={...copy(d.api.state.workouts[0]),id:'active',finishedAt:null};
 await d.api.remoteRestore();await d.api.remoteResumeSync();assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.activeWorkout.id,'active');assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);
 await d.api.remotePublishLocal();assert.equal(d.api.remoteSyncPaused(),false);assert.equal(s.obj.activeWorkout.id,'active');assert.equal(d.api.state.activeWorkout.id,'active');
 const fresh=setup(100,'local'),server=new S3(fixture(200,'cloud'));server.attach(fresh);fresh.api.confirm=async()=>{fresh.api.state.activeWorkout={...copy(fresh.api.state.workouts[0]),id:'active',finishedAt:null};fresh.api.save();return true;};await fresh.api.remoteRestore();assert.equal(fresh.api.remoteSyncPaused(),true);assert.equal(fresh.api.state.activeWorkout.id,'active');
});
await test('reviewed resume explains replacement, adopts cloud durably and retains rescue',async()=>{
 const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);let body;
 d.api.confirm=async(title,text)=>{body=text;assert.match(title,/Resume automatic/);return true;};
 await d.api.remoteResumeSync();assert.match(body,/cloud copy will replace/i);assert.equal(d.api.state.workouts[0].notes,'cloud');assert.equal(JSON.parse(d.api.rescue).workouts[0].notes,'local');assert.equal(d.api.state.settings.lastModifiedAt,200);assert.equal(d.api.remoteSyncPaused(),false);
});
await test('equal/undated conflicting copies require explicit choice before resuming',async()=>{
 for(const revision of [null,100]){const d=setup(100,'local'),s=new S3(fixture(revision,'cloud'));s.attach(d);let confirmed=false;d.api.confirm=async()=>{confirmed=true;return true;};await d.api.remoteResumeSync();assert.equal(confirmed,false);assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.workouts[0].notes,'local');}
});
await test('publication snapshot/quota/network/bookkeeping failures never clear pause',async()=>{
 for(const failure of ['snapshot','quota','network','bookkeeping','unpause']){const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);const fetch=d.ctx.fetch,set=d.ctx.localStorage.setItem,remove=d.ctx.localStorage.removeItem;
 d.ctx.fetch=async(u,o)=>{if(failure==='snapshot'&&u.includes('.snapshots/'))return new Response('',{status:403});if(failure==='network'&&o.method==='PUT'&&!u.includes('.snapshots/'))throw Error('network failure');return fetch(u,o);};
 d.ctx.localStorage.setItem=(k,v)=>{if(failure==='quota'&&k==='liftlog.v1'||failure==='bookkeeping'&&k==='liftlog.v1.remote-work')throw Error('quota');return set(k,v);};
 d.ctx.localStorage.removeItem=k=>{if(failure==='unpause'&&k==='liftlog.v1.remote-paused')throw Error('remove denied');return remove(k);};
 await d.api.remotePublishLocal();assert.equal(d.api.remoteSyncPaused(),true);assert.equal(d.api.state.workouts[0].notes,'local');if(['snapshot','quota','network'].includes(failure))assert.equal(s.obj.workouts[0].notes,'cloud');}
});
await test('pause survives config changes; changing/forgetting during reviewed publication cancels completion',async()=>{
 const d=setup();d.api.pauseRemoteSync();d.api.saveRemoteConfig({...cfg,bucket:'changed'});assert.equal(d.api.remoteSyncPaused(),true);const re=device(d.storage);assert.equal(re.api.remoteSyncPaused(),true);
 for(const change of ['change','forget','pause']){const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);const g=gate();let waiting=false;d.api.confirm=()=>{waiting=true;return g.promise;};const p=d.api.remotePublishLocal();await until(()=>waiting);
 if(change==='change')d.api.saveRemoteConfig({...cfg,bucket:'changed'});else if(change==='forget')d.api.clearRemoteConfig();else d.api.pauseRemoteSync();g.resolve(true);await p;assert.equal(s.calls.filter(x=>x.method==='PUT').length,0);assert.equal(d.api.state.workouts[0].notes,'local');assert.equal(d.api.remoteSyncPaused(),true);}
});
await test('edits during explicit PUT stay pending after successful reviewed resume',async()=>{
 const d=setup(100,'local'),s=new S3(fixture(200,'cloud'));s.attach(d);const g=gate();s.beforePut=()=>g.promise;const p=d.api.remotePublishLocal();
 await until(()=>s.calls.some(x=>x.method==='PUT'&&!x.url.includes('.snapshots/')));const published=d.api.state.settings.lastModifiedAt;d.api.state.workouts[0].notes='new edit';d.api.save();g.resolve();await p;
 assert.equal(d.api.remoteSyncPaused(),false);assert.equal(d.api.readRemoteWork().pending,true);assert.equal(d.api.ui.remoteStatus,'pending');assert.equal(s.obj.workouts[0].notes,'local');assert.equal(JSON.parse(d.storage.get('liftlog.v1.remote')).lastUploadedModifiedAt,published);
});
console.log(`${passed} remote data-management tests passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});

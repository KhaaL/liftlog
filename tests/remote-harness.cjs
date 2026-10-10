const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').split('<script>')[1].split('</script>')[0];
// Run the shipped closure, with only presentation replaced. State, validation,
// migrations, signer, stream bounds, coordinator and persistence remain real.
function device(storage = new Map()) {
  const timers = new Map(); let tid = 0;
  const node = new Proxy(function(){}, {get:(_,k) => k === 'querySelectorAll' ? () => [] : k === 'then' ? undefined : node, apply:() => node, set:() => true});
  const ctx = { console, URL, TextEncoder, TextDecoder, AbortController, Headers, Response, ReadableStream, Blob,
    crypto:webcrypto, navigator:{onLine:true}, location:{protocol:'https:',hostname:'liftlog.test'},
    document:node, localStorage:{getItem:k=>storage.get(k) ?? null, setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    setTimeout:(fn,delay)=>{timers.set(++tid,{fn,delay}); return tid;},clearTimeout:id=>timers.delete(id),setInterval:()=>0,
    fetch:async()=>{throw Error('Unexpected network call');}, requestAnimationFrame:()=>0 };
  ctx.window=ctx; ctx.addEventListener=()=>{};
  vm.createContext(ctx);
  const seam = `
    render=()=>{}; applyTheme=()=>{}; drawTimer=()=>{}; cancelRestBeep=()=>{}; restoreTimer=()=>{};
    toast=(text)=>messages.push(text); announce=()=>{}; updateSaveBanner=()=>{};
    confirmDlg=async()=>true;
    window.api={save,flushSave,prepareBackup,backupPayload,backupDataKey,remoteStartupSync,autoRemoteBackup,remoteBackup,remoteRestore,
      putRemoteBackup,installRemoteSnapshot,commitSnapshot,applyFullBackup,readRemoteBackup,s3Request,validateRemoteConfig,
      testAndSaveRemoteConfig,saveRemoteConfig,clearRemoteConfig,readRemoteWork,scheduleRemoteBackup,remoteTestConnection,
      get state(){return state},set state(v){state=v},get ui(){return ui},get saveFailed(){return saveFailed},
      set existing(v){loadedExistingState=v}, get generation(){return remoteGeneration},
      get rescue(){return localStorage.getItem(LS_REMOTE_RESTORE_KEY)},
      async idle(){await remoteQueue}, set confirm(fn){confirmDlg=fn},
      get controllers(){return remoteControllers}, readJSONFile, actions, set download(fn){downloadBlob=fn}};
  `;
  ctx.messages=[];
  vm.runInContext(source.replace('/* @test-seam */',seam).replace(/\ninit\(\);\n/, '\n'),ctx);
  return {ctx,api:ctx.api,storage,timers,messages:ctx.messages};
}
module.exports={device};

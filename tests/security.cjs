// Node + Playwright; optionally set BROWSER_PATH to an installed Chromium.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8').replace('init();\n})();', `window.testAPI = { prepareBackup, validateBackup, backupPayload, applyFullBackup, importData, importHistory, readJSONFile, remoteRestore, navigate, render, save, get state(){return state}, get ui(){return ui} };\ninit();\n})();`);
const origin = 'https://liftlog.test/';
const fixture = () => ({
  app:'liftlog', kind:'backup', version:9,
  settings:{ theme:'system', unit:'kg', defaultRest:90, autoRest:false, sound:false, vibrate:false, effortMetric:'rir' },
  exercises:[{id:'ex', name:'Squat', unit:'kg'}, {id:'time', name:'Plank', unit:'time'}],
  routines:[{id:'routine', name:'Routine', items:[{id:'item',exerciseId:'ex',sets:3,repsMin:5,repsMax:8,targetRir:2,weight:20}]}],
  workouts:[{id:'history', routineId:'routine', routineName:'History', startedAt:1700000000000, finishedAt:1700000300000,
    exercises:[{exerciseId:'ex',name:'Squat',unit:'kg',sets:[{id:'set',weight:20,reps:5,rpe:8,completed:true}]},
      {exerciseId:'time',name:'Plank',unit:'time',sets:[{id:'timed-set',durationSeconds:45,reps:null,completed:true}]}]}],
  exerciseLinks:[], historySeparateIds:[],
  activeWorkout:null
});
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  const errors = [];
  const newPage = async (options = {}) => {
    const context = await browser.newContext({serviceWorkers:'block'});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(origin)
      ? route.fulfill({contentType:'text/html',body:html}) : route.abort());
    if (options.raw !== undefined) await page.addInitScript(({raw,rescue,failRescue}) => {
      localStorage.setItem('liftlog.v1', raw);
      if (rescue !== undefined) localStorage.setItem('liftlog.v1.unreadable', rescue);
      if (failRescue){
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key,value){
          if (key === 'liftlog.v1.unreadable') throw new DOMException('Full', 'QuotaExceededError');
          return original.call(this,key,value);
        };
      }
    }, options);
    await page.goto(origin);
    return page;
  };
  try {
    const page = await newPage();
    const good = fixture();
    const cases = [
      ['missing collection', s => delete s.workouts],
      ['missing routine items', s => delete s.routines[0].items],
      ['null exercise', s => s.exercises.push(null)],
      ['array instead of settings', s => s.settings = []],
      ['blank name', s => s.exercises[0].name = ' '],
      ['duplicate exercise ID', s => s.exercises.push({...s.exercises[0]})],
      ['duplicate routine ID', s => s.routines.push(structuredClone(s.routines[0]))],
      ['duplicate item ID', s => s.routines[0].items.push({...s.routines[0].items[0]})],
      ['duplicate workout ID', s => s.workouts.push(structuredClone(s.workouts[0]))],
      ['duplicate set ID across workout blocks', s => s.workouts[0].exercises[1].sets[0].id = 'set'],
      ['active ID already in history', s => s.activeWorkout = structuredClone(s.workouts[0])],
      ['missing sets', s => delete s.workouts[0].exercises[0].sets],
      ['null set', s => s.workouts[0].exercises[0].sets.push(null)],
      ['object ID', s => s.workouts[0].id = {}],
      ['control character ID', s => s.routines[0].id = 'a\u0000b'],
      ['string version', s => s.version = '3'],
      ['fractional version', s => s.version = 3.5],
      ['future version', s => s.version = 10],
      ['malformed history link', s => s.exerciseLinks = [{sourceId:'old',targetId:7}]],
      ['self history link', s => s.exerciseLinks = [{sourceId:'ex',targetId:'ex'}]],
      ['duplicate history link source', s => s.exerciseLinks = [{sourceId:'old',targetId:'ex'},{sourceId:'old',targetId:'time'}]],
      ['duplicate separate history ID', s => s.historySeparateIds = ['old','old']],
      ['wrong app', s => s.app = 'other'],
      ['wrong kind', s => s.kind = 'remote-config'],
      ['missing timestamp', s => delete s.workouts[0].startedAt],
      ['out of range date', s => s.workouts[0].startedAt = 1e30],
      ['HTML in measurement', s => s.workouts[0].exercises[0].sets[0].rpe = '<img src=x onerror=alert(1)>'],
      ['string boolean', s => s.workouts[0].exercises[0].sets[0].completed = 'false'],
      ['out of range active index', s => {s.activeWorkout=structuredClone(s.workouts[0]);s.activeWorkout.id='active';s.activeWorkout.currentExerciseIndex=10;}],
      ['malformed active workout', s => s.activeWorkout = {id:'active'}],
      ['malformed timer', s => s.workouts[0].timer = {running:true,remaining:'oops'}]
    ].map(([label,mutate]) => {const value=structuredClone(good);mutate(value);return {label,value};});
    const validation = await page.evaluate(({good,cases}) => {
      const t=window.testAPI;
      const before=JSON.stringify(t.state), stored=localStorage.getItem('liftlog.v1');
      for (const {label,value} of cases){
        let rejected=false;
        try { t.prepareBackup(value); } catch(e){ rejected=true; }
        if (!rejected) throw Error('Accepted ' + label);
        t.applyFullBackup(value);
        if (document.querySelector('dialog[open]')) throw Error('Asked for confirmation: ' + label);
        if (JSON.stringify(t.state)!==before || localStorage.getItem('liftlog.v1')!==stored) throw Error('Changed state: ' + label);
      }
      const historical=structuredClone(good); historical.workouts[0].currentExerciseIndex=10;
      if(t.prepareBackup(historical).workouts[0].currentExerciseIndex!==2) throw Error('Stale history cursor not clamped');
      const serialized=JSON.stringify(good), prepared=t.prepareBackup(good);
      if (JSON.stringify(good)!==serialized || prepared===good) throw Error('Mutated input');
      const dangling=structuredClone(good); dangling.exercises=[];
      t.prepareBackup(dangling); // users can delete definitions without deleting history/routines
      return cases.length;
    }, {good,cases});
    console.log('PASS ' + validation + ' invalid backup cases reject before confirmation without changing memory/storage');
    // Test actual file parsing separately from structural validation and callback errors.
    await page.evaluate(value => window.testAPI.importData(new File([JSON.stringify(value)],'bad.json')), cases[0].value);
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('Invalid backup')));
    await page.evaluate(() => {
      document.getElementById('toast-region').replaceChildren();
      window.testAPI.importData(new File(['{'],'parse.json'));
    });
    await page.waitForFunction(() => document.getElementById('toast-region').textContent.includes('not valid JSON'));
    await page.evaluate(() => {
      document.getElementById('toast-region').replaceChildren();
      window.testAPI.readJSONFile(new File(['{}'],'callback.json'), () => {throw Error('callback failure');});
    });
    await page.waitForFunction(() => document.getElementById('toast-region').textContent.includes('Could not import'));
    assert.equal(await page.locator('#toast-region').textContent().then(x => x.includes('not valid JSON')),false);
    console.log('PASS JSON parsing errors and import errors are distinct');
    for (let version=1;version<=9;version++){
      const legacy=fixture(); legacy.version=version; delete legacy.app; delete legacy.kind;
      if(version<=8){delete legacy.exerciseLinks;delete legacy.historySeparateIds;}
      if(version<=7){const item=legacy.routines[0].items[0];item.reps=item.repsMin;delete item.repsMin;delete item.repsMax;delete item.targetRir;}
      if(version<=2){const set=legacy.workouts[0].exercises[1].sets[0];set.reps=set.durationSeconds;delete set.durationSeconds;}
      if(version<=3) delete legacy.settings.effortMetric;
      if(version<=5){legacy.routines[0].items[0].rest=60;legacy.workouts[0].exercises[0].restSeconds=60;}
      const prepared=await page.evaluate(s => window.testAPI.prepareBackup(s),legacy);
      assert.equal(prepared.version,9);
      assert.equal(prepared.routines[0].items[0].repsMin,version===1 ? 10 : 5);
      assert.equal(prepared.routines[0].items[0].repsMax,version===1 ? 15 : (version<=7 ? 5 : 8));
      assert.equal(prepared.workouts[0].exercises[1].sets[0].durationSeconds,45);
      assert.equal(prepared.workouts[0].exercises[1].sets[0].reps,null);
      assert.equal(prepared.workouts[0].exercises[0].sets[0].rpe,8);
      if(version<=3) assert.equal(prepared.settings.effortMetric,'rpe');
      if(version<=5) assert.equal('restSeconds' in prepared.workouts[0].exercises[0],false);
    }
    console.log('PASS v1–v9 backups migrate and preserve history');
    const beforeCancel=await page.evaluate(() => JSON.stringify(window.testAPI.state));
    await page.evaluate(s => {window.testAPI.applyFullBackup(s);},good);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.testAPI.state)),beforeCancel);
    console.log('PASS cancelling valid restore leaves state untouched');

    const attack=`opaque" data-injected="yes" onclick="window.__injected=true"><img data-injected src=x onerror="window.__injected=true"> &'<`;
    const malicious=fixture();
    malicious.exercises[0].id='ex-'+attack;
    malicious.routines[0].id='routine-'+attack;
    malicious.routines[0].items[0].id='item-'+attack;
    malicious.routines[0].items[0].exerciseId=malicious.exercises[0].id;
    malicious.workouts[0].id='history-'+attack;
    malicious.workouts[0].routineId=malicious.routines[0].id;
    malicious.workouts[0].exercises[0].exerciseId=malicious.exercises[0].id;
    malicious.workouts[0].exercises[0].sets[0].id='set-'+attack;
    malicious.activeWorkout=structuredClone(malicious.workouts[0]);
    malicious.activeWorkout.id='active-'+attack;
    malicious.activeWorkout.currentExerciseIndex=0;
    malicious.activeWorkout.finishedAt=null;
    malicious.activeWorkout.exercises.forEach(ex=>ex.sets.forEach(set=>set.completed=false));
    await page.evaluate(s => {window.testAPI.importData(new File([JSON.stringify(s)],'hostile-ids.json'));},malicious);
    await page.getByRole('button',{name:'Import & replace',exact:true}).click();
    const assertInert = async () => {
      assert.equal(await page.locator('[data-injected]').count(),0);
      assert.equal(await page.evaluate(() => !!window.__injected),false);
    };
    await assertInert();
    const setId=malicious.activeWorkout.exercises[0].sets[0].id;
    assert.equal(await page.locator('[data-action="toggle-set"]').first().getAttribute('data-id'),setId);
    await page.locator('[data-action="toggle-set"]').first().click();
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].sets[0].completed),true);
    await page.evaluate(() => window.testAPI.navigate('routines'));
    await assertInert();
    await page.getByRole('button',{name:'Edit Routine',exact:true}).click();
    assert.equal(await page.locator('#routine-add-select option').filter({hasText:'Squat'}).getAttribute('value'),malicious.exercises[0].id);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(() => window.testAPI.navigate('exercises'));
    await assertInert();
    await page.getByRole('button',{name:'Edit Squat',exact:true}).click();
    await assertInert();
    await page.evaluate(() => window.testAPI.navigate('history'));
    await assertInert();
    assert.equal(await page.locator('option').evaluateAll((els,id)=>els.some(e=>e.value===id),malicious.exercises[0].id),true);
    await page.locator('[data-action="history-toggle"]').click();
    await page.getByRole('button',{name:'Edit session',exact:true}).click();
    await assertInert();
    const weight=page.locator('[data-bind="hset"][data-field="weight"]').first();
    assert.equal(await weight.getAttribute('data-sid'),setId);
    assert.equal(await weight.getAttribute('id'),'hw-'+setId);
    await weight.fill('42');
    assert.equal(await page.evaluate(() => window.testAPI.state.workouts[0].exercises[0].sets[0].weight),42);
    await page.reload();
    await assertInert();
    assert.equal(await page.evaluate(() => window.testAPI.state.workouts[0].id),malicious.workouts[0].id);
    console.log('PASS hostile IDs remain inert and usable through full restore, every affected view, editing and reload');

    // Transfer import uses a separate normalizer; test it too, including numeric/duplicate set IDs.
    const imported=fixture().workouts[0]; imported.id='transfer-'+attack;
    imported.routineId='invalid\u0000id';
    imported.exercises[1].exerciseId='invalid\u0000id';
    imported.exercises[0].sets[0].id='transfer-set-'+attack;
    imported.exercises[1].sets=[{id:17,durationSeconds:30,completed:true,completedAt:1e30},{id:17,durationSeconds:40,completed:true}];
    await page.evaluate(w=>window.testAPI.importHistory(new File([JSON.stringify({workouts:[w]})],'history.json')),imported);
    await page.waitForFunction(id=>window.testAPI.state.workouts.some(w=>w.id===id),imported.id);
    await page.evaluate(() => window.testAPI.navigate('history'));
    await assertInert();
    await page.locator('[data-action="history-toggle"]').evaluateAll((els,id)=>els.find(e=>e.dataset.id===id).click(),imported.id);
    await page.locator('[data-action="history-edit"]').click();
    await assertInert();
    await page.evaluate(() => window.testAPI.prepareBackup(window.testAPI.backupPayload()));
    const countBefore=await page.evaluate(()=>window.testAPI.state.workouts.length);
    await page.evaluate(()=>{
      const active=window.testAPI.state.activeWorkout;
      const invalidDate={...active,id:'bad-date',startedAt:1e30};
      window.testAPI.importHistory(new File([JSON.stringify({workouts:[active,invalidDate]})],'duplicates.json'));
    });
    await page.waitForFunction(()=>document.getElementById('toast-region').textContent.includes('0 new · 1 already present · 1 invalid'));
    assert.equal(await page.evaluate(()=>window.testAPI.state.workouts.length),countBefore);
    console.log('PASS hostile transfer IDs stay inert; numeric/duplicate set IDs produce valid backups');

    // Exercise the remote restore entry point with mocked HTTP, real JSON/signing/validation.
    await page.route('https://storage.test/**',route=>route.fulfill({json:cases[1].value}));
    const remoteBefore=await page.evaluate(() => JSON.stringify(window.testAPI.state));
    await page.evaluate(async () => {
      document.getElementById('toast-region').replaceChildren();
      localStorage.setItem('liftlog.v1.remote',JSON.stringify({endpoint:'https://storage.test',bucket:'test',region:'test',accessKeyId:'test',secretAccessKey:'test',pathStyle:true}));
      await window.testAPI.remoteRestore();
    });
    assert.equal(await page.evaluate(() => JSON.stringify(window.testAPI.state)),remoteBefore);
    assert.match(await page.locator('#toast-region').textContent(), /Invalid backup — routines\[0\]\.items/);
    assert.equal(await page.locator('dialog[open]').count(),0);
    console.log('PASS remote restore rejects invalid backup before confirmation');

    // Startup must preserve every byte of failed input, including if rescue storage cannot be written.
    for (const raw of ['{broken',JSON.stringify(cases[1].value),JSON.stringify({...good,version:99})]){
      const recovery=await newPage({raw});
      assert.equal(await recovery.evaluate(()=>localStorage.getItem('liftlog.v1.unreadable')),raw);
      assert.equal(await recovery.evaluate(()=>window.testAPI.state.version),9);
      await recovery.context().close();
    }
    for (const options of [{failRescue:true},{rescue:'previous recovery copy'}]){
      const raw=JSON.stringify(cases[1].value);
      const recovery=await newPage({raw,...options});
      await recovery.evaluate(()=>{window.testAPI.state.settings.defaultRest=120;window.testAPI.save();});
      assert.equal(await recovery.evaluate(()=>localStorage.getItem('liftlog.v1')),raw);
      assert.equal(await recovery.locator('#save-banner').isVisible(),true);
      if(options.rescue) assert.equal(await recovery.evaluate(()=>localStorage.getItem('liftlog.v1.unreadable')),options.rescue);
      await recovery.evaluate(s=>{window.testAPI.applyFullBackup(s);},good);
      await recovery.getByRole('button',{name:'Import & replace',exact:true}).click();
      assert.equal(await recovery.evaluate(()=>JSON.parse(localStorage.getItem('liftlog.v1')).routines[0].id),'routine');
      await recovery.context().close();
    }
    console.log('PASS corrupt/malformed/future startup data is rescued; rescue failures preserve original storage until explicit restore');
    assert.deepEqual(errors,[]);
    console.log('PASS no browser errors');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

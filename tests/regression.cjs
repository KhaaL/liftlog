// Run with Node and Playwright available; BROWSER_PATH optionally selects Chromium.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_PATH ? { executablePath:process.env.BROWSER_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let html = fs.readFileSync('index.html', 'utf8');
    html = html.replace('init();\n})();', `window.testAPI = { sampleRoutinesFile, sampleHistoryFile, routinesPayload, backupPayload, applyFullBackup, validateBackup, importRoutines, importHistory, migrateState, normalizeState, defaultSettings, normalizeRoutineItem, cleanRoutinePairs, keepRoutinePairsAdjacent, routineGroups, routineSummary, workoutSets, workoutPlannedSets, progressionStatus, pairRoutineItems, unpairRoutineItems, duplicateRoutine, removeRoutineItem, saveRoutineDraft, startRoutine, toggleSet, htmlRoutineEditor, render, get state(){return state}, get ui(){return ui} };\ninit();\n})();`);
    await page.route('http://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('http://liftlog.test/');
    const result = await page.evaluate(async () => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const file = obj => new File([JSON.stringify(obj)], 'sample.json', {type:'application/json'});
      const wait = () => new Promise(r => setTimeout(r, 60));
      t.state.exercises = []; t.state.routines = []; t.state.workouts = [];
      const sample = t.sampleRoutinesFile();
      check(sample.version === 7 && sample.schemaVersion === '1.4.0', 'sample version markers');
      t.importRoutines(file(sample)); await wait();
      check(t.state.routines.length === 1 && t.state.exercises.length === 3, 'routine sample imports all definitions');
      const r = t.state.routines[0];
      check(t.routineGroups(r.items).length === 2, 'sample pair survives import');
      t.importRoutines(file(sample)); await wait();
      check(t.state.routines.length === 1, 'routine import deduplicates');
      const history = t.sampleHistoryFile();
      t.importHistory(file(history)); await wait();
      const sets = t.state.workouts[0].exercises.flatMap(e => e.sets);
      check(sets.length === 5 && sets[0].countForVolume === false && sets[0].countForPR === false, 'history warm-up flags survive');
      check(sets[3].reps === null && sets[3].durationSeconds === 45 && sets[2].rir === 0, 'timed sets and zero RIR survive');
      t.importHistory(file(history)); await wait();
      check(t.state.workouts.length === 1, 'history import deduplicates');
      const normalized = t.normalizeRoutineItem({sets:2.9,reps:0,weight:-3});
      check(normalized.sets === 2 && normalized.reps === 0 && normalized.weight === null, 'routine target normalization');
      const old = {version:3, settings:{theme:'invalid',effortMetric:'invalid'}, exercises:[], routines:[{items:[{rest:60,sets:3,reps:5}]}],workouts:[{startedAt:1,exercises:[{restSeconds:60,sets:[{rpe:8}]}]}]};
      t.normalizeState(t.migrateState(old));
      check(old.version === 7 && old.settings.effortMetric === 'rpe' && old.settings.theme === 'system' && !('rest' in old.routines[0].items[0]) && !('restSeconds' in old.workouts[0].exercises[0]), 'complete migration chain and settings fallback');
      const roundtrip = structuredClone(t.routinesPayload(t.state.exercises, [r]));
      roundtrip.routines[0].name = 'Round trip';
      t.importRoutines(file(roundtrip)); await wait();
      check(t.routineGroups(t.state.routines[1].items).length === 2, 'real export and reimport preserve pair');
      t.state.routines.splice(1);
      const invalid = [{exerciseId:'a',eitherOf:'g'}, {exerciseId:'b',eitherOf:'g'}, {exerciseId:'c',eitherOf:'g'}];
      t.cleanRoutinePairs(invalid);
      check(invalid.every(it => !it.eitherOf), 'oversized groups become independent');
      check(t.routineSummary([{exerciseId:'a',sets:2,eitherOf:'g'}, {exerciseId:'b',sets:4,eitherOf:'g'}]) === '1 exercise · 2–4 planned sets', 'pair summary shows target range');
      const separated = [{exerciseId:'a',eitherOf:'g'}, {exerciseId:'c'}, {exerciseId:'b',eitherOf:'g'}];
      t.keepRoutinePairsAdjacent(separated);
      check(separated.map(it => it.exerciseId).join(',') === 'a,b,c', 'pair normalization places alternatives together');
      t.duplicateRoutine(r.id);
      check(t.routineGroups(t.state.routines[1].items).length === 2 && t.state.routines[1].items[0].id !== r.items[0].id, 'duplicate preserves pairs with new item IDs');
      t.ui.routineDraft = structuredClone(r);
      t.removeRoutineItem(0);
      check(!t.ui.routineDraft.items.some(it => it.eitherOf), 'removal dissolves pair');
      t.ui.routineDraft = structuredClone(r);
      t.unpairRoutineItems(t.ui.routineDraft.items[0].eitherOf);
      check(!t.ui.routineDraft.items.some(it => it.eitherOf), 'unlink dissolves pair');
      const second = t.ui.routineDraft.items.splice(1, 1)[0];
      t.ui.routineDraft.items.push(second);
      check(t.pairRoutineItems(t.ui.routineDraft.items[0].id, second.id), 'pair distinct items');
      check(t.ui.routineDraft.items[1] === second, 'pairing nonadjacent items moves them together');
      t.ui.routineDraft.items.reverse();
      check(t.routineGroups(t.ui.routineDraft.items).length === 2, 'reordering preserves pair');
      t.ui.routineDraft = structuredClone(r); t.ui.view = 'routines';
      t.saveRoutineDraft();
      return checks;
    });
    await page.getByRole('button', { name:'Edit Lower body', exact:true }).click();
    assert.equal(await page.locator('.item-name select').count(), 0, 'editor has no per-row partner selectors');
    await page.getByRole('button', {name:'Pair exercises…'}).click();
    const pairDialog = page.getByRole('dialog', {name:'Either of'});
    await pairDialog.getByRole('button', {name:'Close'}).click();
    assert.equal(await page.locator('#routine-form .either-pair').count(), 2, 'closing picker keeps existing pair');
    await page.getByRole('button', {name:'Pair exercises…'}).click();
    await pairDialog.getByRole('button', {name:'Unpair'}).click();
    assert.equal(await page.locator('#routine-form .either-pair').count(), 0, 'unpair removes both markers');
    await page.getByRole('button', {name:'Pair exercises…'}).click();
    await pairDialog.getByLabel('First exercise').selectOption({label:'Back Squat · #1'});
    await pairDialog.getByLabel('Or this exercise').selectOption({label:'Leg Press · #2'});
    await pairDialog.screenshot({path:'/tmp/liftlog-pair-picker.png'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'pair picker fits phone width');
    await pairDialog.getByRole('button', {name:'Pair exercises'}).click();
    assert.equal(await page.locator('#routine-form .either-pair').count(), 2, 'picker creates a visible pair');
    assert.equal(await page.locator('#routine-form .pair-badge').count(), 0, 'editor omits repeated pair labels');
    assert.equal(await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#routine-form .item-row')];
      const probe = document.createElement('span');
      probe.style.color = 'var(--either)'; document.body.append(probe);
      const violet = getComputedStyle(probe).color;
      probe.style.color = 'var(--success)';
      const green = getComputedStyle(probe).color;
      probe.remove();
      return rows.length === 3 && rows[0].classList.contains('either-first') &&
        rows[1].classList.contains('either-last') && !rows[2].classList.contains('either-pair') &&
        getComputedStyle(rows[0], '::before').borderLeftColor === violet && violet !== green &&
        getComputedStyle(rows[1], '::after').content === '"OR"';
    }), true, 'adjacent alternatives have a violet bracket and one OR pill');
    await page.getByRole('button', {name:'Move Back Squat and Leg Press down'}).first().click();
    assert.deepEqual(await page.evaluate(() => {
      const t = window.testAPI;
      return t.ui.routineDraft.items.map(it => t.state.exercises.find(ex => ex.id === it.exerciseId).name);
    }), ['Plank', 'Back Squat', 'Leg Press'], 'arrow moves both alternatives together');
    await page.getByRole('button', {name:'Move Back Squat and Leg Press up'}).first().click();
    assert.deepEqual(await page.evaluate(() => {
      const t = window.testAPI;
      return t.ui.routineDraft.items.map(it => t.state.exercises.find(ex => ex.id === it.exerciseId).name);
    }), ['Back Squat', 'Leg Press', 'Plank'], 'arrow restores paired position');
    await page.waitForTimeout(3000); // let transient import toasts leave the layout
    await page.screenshot({path:'/tmp/liftlog-editor.png', fullPage:true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile editor fits viewport');
    await page.getByRole('button', {name:'Save routine', exact:true}).click();
    await page.locator('[data-action="routine-start"]').first().click();
    let workout = await page.evaluate(() => window.testAPI.state.activeWorkout);
    assert.deepEqual(workout.exercises.map(e => e.name), ['Back Squat', 'Leg Press', 'Plank'], 'both alternatives start in session');
    await page.locator('#overview-toggle-btn').click();
    assert.equal(await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#overview-dlg-body .overview-row')];
      return rows.length === 3 && rows[0].classList.contains('either-first') &&
        rows[1].classList.contains('either-last') && !rows[2].classList.contains('either-pair') &&
        getComputedStyle(rows[1], '::after').content === '"OR"';
    }), true, 'active workout overview shows the same paired marker');
    await page.locator('#overview-dlg').screenshot({path:'/tmp/liftlog-overview-pair.png'});
    await page.getByRole('button', {name:'Move Leg Press later'}).click();
    assert.equal(await page.locator('#overview-dlg-body .either-inline').count(), 2,
      'separated alternatives keep individual OR cues');
    assert.equal(await page.locator('#overview-dlg-body .either-pair').count(), 0,
      'bracket does not connect unrelated rows');
    await page.getByRole('button', {name:'Move Leg Press earlier'}).click();
    assert.equal(await page.locator('#overview-dlg-body .either-pair').count(), 2,
      'bringing alternatives together restores bracket');
    await page.getByRole('button', {name:'Back to workout'}).click();
    assert.equal(await page.evaluate(() => {
      const t = window.testAPI;
      t.validateBackup(t.backupPayload());
      return t.state.activeWorkout.exercises[0].eitherOf === t.state.activeWorkout.exercises[1].eitherOf;
    }), true, 'backup schema accepts an active either-of pair');
    assert.equal(await page.evaluate(() => window.testAPI.workoutPlannedSets(window.testAPI.state.activeWorkout)), 5,
      'paired alternatives count once in planned sets');
    assert.deepEqual(await page.evaluate(() => {
      const t = window.testAPI, w = structuredClone(t.state.activeWorkout);
      w.exercises[0].sets[0].completed = true;
      w.exercises[1].sets[0].completed = true;
      return [t.workoutSets(w), t.workoutPlannedSets(w)];
    }), [1, 5], 'partial work on both alternatives counts once in progress');
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.settings.autoRest = false;
      t.state.activeWorkout.exercises[0].sets.map(s => s.id).forEach(t.toggleSet);
    });
    workout = await page.evaluate(() => window.testAPI.state.activeWorkout);
    assert.deepEqual(workout.exercises.map(e => e.name), ['Back Squat', 'Plank'], 'completing first alternative removes second from session');
    await page.locator('#overview-toggle-btn').click();
    assert.equal(await page.locator('#overview-dlg-body .either-pair').count(), 0, 'pair marker clears after choosing an alternative');
    await page.getByRole('button', {name:'Back to workout'}).click();
    assert.equal(workout.currentExerciseIndex, 1, 'advances to next exercise after first alternative');
    assert.equal(workout.exercises[1].sets[0].durationSeconds, 45);
    assert.equal(await page.evaluate(() => window.testAPI.state.routines[0].items.length), 3, 'saved routine retains both alternatives');
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.activeWorkout = null;
      t.startRoutine(t.state.routines[0].id);
      t.state.activeWorkout.currentExerciseIndex = 1;
      t.state.activeWorkout.exercises[1].sets.map(s => s.id).forEach(t.toggleSet);
    });
    workout = await page.evaluate(() => window.testAPI.state.activeWorkout);
    assert.deepEqual(workout.exercises.map(e => e.name), ['Leg Press', 'Plank'], 'completing second alternative removes first from session');
    assert.equal(workout.currentExerciseIndex, 1, 'advances correctly when removed partner was earlier');
    assert.equal(workout.exercises[0].sets[0].weight, 120);
    assert.equal(await page.evaluate(() => window.testAPI.state.routines[0].items.length), 3, 'saved routine still retains pair');
    await page.screenshot({path:'/tmp/liftlog-workout.png'});
    await page.evaluate(() => {
      const payload = window.testAPI.backupPayload();
      payload.version = 6;
      payload.activeWorkout.timer = {seconds:90,total:90,remaining:37,running:false,done:false,endsAt:0};
      window.testAPI.applyFullBackup(payload);
    });
    await page.getByRole('button', {name:'Import & replace', exact:true}).click();
    await page.waitForFunction(() => window.testAPI.state.activeWorkout?.timer?.remaining === 37);
    assert.equal(await page.evaluate(() => window.testAPI.state.version), 7, 'full backup restore migrates');
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.timer.remaining), 37, 'backup restore retains rest timer');
    await page.reload();
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].name), 'Leg Press', 'settled workout survives reload');
    const progressionChecks = await page.evaluate(() => {
      const t = window.testAPI, check = (ok, label) => { if (!ok) throw Error(label); return label; };
      const make = (day, reps, weight = 100, opts = {}) => ({
        startedAt:day, exercises:[{ exerciseId:'lift', unit:opts.kind || 'kg', plannedSets:3,
          sets:[...(opts.warmup ? [{completed:true, countForVolume:false, countForPR:false, unit:'kg', weight:50, reps:10}] : []),
            ...reps.map(r => ({completed:true, unit:opts.unit || 'kg', weight, reps:r}))] }]
      });
      const a = [make(1,[8,8,8]),make(2,[8,8,8]),make(3,[8,8,8]),make(4,[8,8,8])];
      const labels = [];
      labels.push(check(!t.progressionStatus('lift',a.slice(0,3)).flagged &&
        t.progressionStatus('lift',a).streak === 3, 'flag requires three misses after a baseline'));
      labels.push(check(t.progressionStatus('lift',[...a,make(5,[8,8,9])]).streak === 0,
        'more total reps at the same load clear the flag'));
      labels.push(check(t.progressionStatus('lift',[...a,make(5,[6,6,6],102.5)]).streak === 0,
        'higher load clears the flag even when reps drop'));
      labels.push(check(t.progressionStatus('lift',[...a,make(5,[8,8,8],95)]).streak === 0,
        'a lower-load deload begins a new comparison window'));
      labels.push(check(t.progressionStatus('lift',[make(1,[8,8,8],100,{warmup:true}),
        make(2,[8,8,8]),make(3,[8,8,8]),make(4,[8,8,8])]).flagged,
        'warm-ups do not affect comparable working sets'));
      labels.push(check(t.progressionStatus('lift',[...a.slice(0,3),make(4,[8,8]),make(5,[8,8,8])]).streak === 0,
        'partial exposures break the miss streak'));
      const mixed = make(4,[8,8,8]); mixed.exercises[0].sets[1].weight = 90;
      labels.push(check(t.progressionStatus('lift',[...a.slice(0,3),mixed,make(5,[8,8,8])]).streak === 0,
        'mixed working loads break the miss streak'));
      const skipped = {startedAt:3.5,exercises:[{exerciseId:'lift',unit:'kg',plannedSets:3,sets:[]}]};
      labels.push(check(t.progressionStatus('lift',[...a.slice(0,3),skipped,a[3]]).flagged,
        'an unperformed exercise is not an exposure'));
      labels.push(check(t.progressionStatus('lift',[make(1,[8,8,8]),
        make(2,[8,8,8],220.46226218,{unit:'lb'}),make(3,[8,8,8]),make(4,[8,8,8])]).flagged,
        'kg and lb loads compare consistently'));
      labels.push(check(t.progressionStatus('lift',[make(1,[8,8,8],null,{kind:'bw'}),
        make(2,[8,8,8],null,{kind:'bw'}),make(3,[8,8,8],null,{kind:'bw'}),
        make(4,[8,8,8],null,{kind:'bw'})]).flagged,
        'bodyweight rep exposures can flag'));
      labels.push(check(!t.progressionStatus('lift',a.map(w => ({...w,exercises:w.exercises.map(ex => ({...ex,unit:'time'}))}))).flagged,
        'timed work does not receive a double-progression flag'));
      const squat = t.state.exercises.find(ex => ex.name === 'Back Squat');
      t.state.workouts = a.map((w,i) => ({...w,id:'plateau-'+i,routineName:'Lower body',
        startedAt:Date.now() - (4-i)*86400000,finishedAt:Date.now() - (4-i)*86400000 + 1800000,
        exercises:w.exercises.map(ex => ({...ex,exerciseId:squat.id,name:squat.name,category:'Legs'}))})).reverse();
      t.ui.view = 'history'; t.render();
      return labels;
    });
    assert.equal(await page.locator('#progression-flags .progression-list li').count(), 1,
      'History shows one progression flag');
    assert.match(await page.locator('#progression-flags').innerText(), /Last: .*100 kg · 8 \/ 8 \/ 8 reps/,
      'flag shows the latest working-set load and reps');
    assert.match(await page.locator('.trend-foot').first().innerText(), /No change/,
      'flat strength trend is neutral rather than a green gain');
    await page.getByRole('button', {name:'Show progress for Back Squat'}).click();
    assert.equal(await page.locator('#progress-exercise-select').inputValue(),
      await page.evaluate(() => window.testAPI.state.exercises.find(ex => ex.name === 'Back Squat').id),
      'flag opens the matching exercise trend');
    await page.screenshot({path:'/tmp/liftlog-history-progression.png',fullPage:true});
    await page.evaluate(() => {
      const t = window.testAPI;
      t.state.workouts[0].exercises[0].sets[0].reps = 9;
      t.render();
    });
    assert.equal(await page.locator('#progression-flags').count(), 0,
      'correcting a logged set clears a stale flag without stored flag state');
    assert.deepEqual(errors, []);
    console.log([...result, ...progressionChecks, 'mobile editor pairing and in-session alternative completion',
      'History progression flag and navigation', 'no browser errors'].map(s => 'PASS ' + s).join('\n'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

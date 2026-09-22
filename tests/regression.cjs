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
    html = html.replace('init();\n})();', `window.testAPI = { sampleRoutinesFile, sampleHistoryFile, routinesPayload, historyPayload, backupPayload, applyFullBackup, prepareBackup, validateBackup, importRoutines, importHistory, normalizeImportedSet, normalizeImportedWorkout, migrateState, normalizeState, defaultSettings, normalizeRoutineItem, cleanRoutinePairs, keepRoutinePairsAdjacent, routineGroups, routineSummary, workoutSets, workoutPlannedSets, workoutVolume, progressionStatus, pairRoutineItems, unpairRoutineItems, duplicateRoutine, removeRoutineItem, saveRoutineDraft, saveExerciseDraft, startRoutine, toggleSet, setUnit, htmlRoutineEditor, trendCandidates, exSessions, canonicalExerciseId, unresolvedHistoryExercises, compatibleHistoryLink, setExerciseLink, keepHistoricalExerciseSeparate, addHistoricalExerciseToLibrary, remoteStartupSync, autoRemoteBackup, flushSave, save, render, get state(){return state}, get ui(){return ui} };\ninit();\n})();`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const result = await page.evaluate(async () => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const file = obj => new File([JSON.stringify(obj)], 'sample.json', {type:'application/json'});
      const wait = () => new Promise(r => setTimeout(r, 60));
      t.state.exercises = []; t.state.routines = []; t.state.workouts = [];
      const sample = t.sampleRoutinesFile();
      check(sample.version === 10 && sample.schemaVersion === '1.8.0', 'sample version markers');
      t.importRoutines(file(sample)); await wait();
      check(t.state.routines.length === 1 && t.state.exercises.length === 3, 'routine sample imports all definitions');
      const r = t.state.routines[0];
      check(r.id === 'rt-lower' && t.state.exercises.some(ex => ex.id === 'ex-squat'),
        'routine import preserves safe source identities');
      check(t.routineGroups(r.items).length === 2, 'sample pair survives import');
      check(r.items[0].repsMin === 5 && r.items[0].repsMax === 8 && r.items[0].targetRir === 2,
        'routine sample preserves rep range and target RIR');
      t.importRoutines(file(sample)); await wait();
      check(t.state.routines.length === 1, 'routine import deduplicates');
      const history = t.sampleHistoryFile();
      t.importHistory(file(history)); await wait();
      const sets = t.state.workouts[0].exercises.flatMap(e => e.sets);
      check(sets.length === 5 && sets[0].countForVolume === false && sets[0].countForPR === false, 'history warm-up flags survive');
      check(sets[3].reps === null && sets[3].durationSeconds === 45 && sets[2].rir === 0, 'timed sets and zero RIR survive');
      t.importHistory(file(history)); await wait();
      check(t.state.workouts.length === 1, 'history import deduplicates');
      check(t.ui.importSummary.added === 0 && t.ui.importSummary.already === 1 &&
        t.ui.importSummary.invalid === 0 && t.ui.importSummary.conflicts === 0,
        'duplicate-only history import reports an existing workout precisely');
      const orphan = { workouts:[{ id:'wk-orphan', routineId:null, routineName:'Old log',
        startedAt:Date.now() - 86400000, finishedAt:Date.now() - 86400000 + 1800000, notes:'',
        exercises:[{ exerciseId:'old-back-squat', name:'Back Squat', category:'Legs', unit:'kg',
          plannedSets:1, targetRepsMin:5, targetRepsMax:8, targetRir:2,
          sets:[{id:'old-set',weight:95,reps:6,rir:2,completed:true,unit:'kg'}] }] }] };
      t.importHistory(file(orphan)); await wait();
      check(t.trendCandidates().some(ex => ex.id === 'old-back-squat'),
        'historical exercises appear in Progress without a Library definition');
      const currentSquat = t.state.exercises.find(ex => ex.id === 'ex-squat');
      check(t.setExerciseLink('old-back-squat', currentSquat.id) &&
        t.canonicalExerciseId('old-back-squat') === currentSquat.id && t.exSessions(currentSquat).length === 2,
        'linking combines old and current progression series');
      check(t.state.workouts.find(w => w.id === 'wk-orphan').exercises[0].exerciseId === 'old-back-squat',
        'linking leaves the original workout record unchanged');
      const timedOrphan = { workouts:[{ id:'wk-old-hold', routineId:null, routineName:'Old hold', startedAt:Date.now()-50000,
        finishedAt:Date.now()-40000, notes:'', exercises:[{exerciseId:'old-plank',name:'Old Plank',category:'Core',unit:'time',
          plannedSets:1,sets:[{id:'old-hold-set',setType:'time',durationSeconds:30,completed:true,unit:'time'}]}] }] };
      t.importHistory(file(timedOrphan)); await wait();
      check(!t.compatibleHistoryLink('old-plank', currentSquat.id) && !t.setExerciseLink('old-plank', currentSquat.id),
        'history links reject a different measurement kind');
      const plank = t.state.exercises.find(ex => ex.id === 'ex-plank');
      check(t.compatibleHistoryLink('old-plank', plank.id) && t.setExerciseLink('old-plank', plank.id),
        'history links accept the same measurement kind');
      t.keepHistoricalExerciseSeparate('old-plank');
      t.state.workouts.push({id:'mixed-identity',startedAt:Date.now(),finishedAt:Date.now(),routineName:'Mixed',notes:'',
        exercises:[{exerciseId:'old-plank',name:'Old Plank',unit:'kg',sets:[]}]});
      check(!t.compatibleHistoryLink('old-plank', plank.id) && !t.compatibleHistoryLink('old-plank', currentSquat.id),
        'a historical ID reused across measurement kinds cannot be linked');
      t.state.workouts.pop();
      const explicitReps = t.normalizeImportedWorkout({id:'explicit-reps',startedAt:1000,exercises:[{
        exerciseId:'mixed',name:'Explicit reps',unit:'time',sets:[{id:'mixed-set',setType:'reps',unit:'time',reps:7,durationSeconds:55,completed:true}]
      }]});
      check(explicitReps.exercises[0].unit === 'kg' && explicitReps.exercises[0].sets[0].unit === 'kg' &&
        explicitReps.exercises[0].sets[0].reps === 7 && explicitReps.exercises[0].sets[0].durationSeconds === null,
        'explicit reps setType overrides a contradictory time unit');
      check(t.normalizeImportedSet({id:'distance-set',setType:'distance',distance:100,completed:true},'kg') === null,
        'unsupported distance sets are dropped instead of becoming uneditable data');
      t.state.bodyweights = [{id:'bw-entry',loggedAt:1,weight:80,unit:'kg'}];
      const bwWorkout = {id:'bw-workout',routineId:null,routineName:'Pull-ups',startedAt:1000,finishedAt:2000,notes:'',
        exercises:[{exerciseId:'bw-lift',name:'Pull-up',unit:'bw',plannedSets:1,sets:[
          {id:'bw-set',unit:'bw',addedWeight:20,addedWeightUnit:'kg',reps:5,completed:true}
        ]}]};
      check(t.workoutVolume(bwWorkout) === 500, 'bodyweight plus added load contributes accurate volume');
      const bwPayload = t.historyPayload([bwWorkout],[],[],t.state.bodyweights);
      check(bwPayload.bodyweights.length === 1 && bwPayload.workouts[0].exercises[0].sets[0].setType === 'reps' &&
        bwPayload.workouts[0].exercises[0].sets[0].addedWeight === 20,
        'history transfer preserves dated bodyweight and added load');
      t.state.bodyweights = [];
      t.importHistory(file(bwPayload)); await wait();
      check(t.state.bodyweights.length === 1 && t.state.workouts.some(w => w.id === 'bw-workout') &&
        t.workoutVolume(t.state.workouts.find(w => w.id === 'bw-workout')) === 500,
        'history import restores bodyweight context and added-load analytics');
      check(t.keepHistoricalExerciseSeparate('old-back-squat') &&
        t.canonicalExerciseId('old-back-squat') === 'old-back-squat' &&
        t.state.historySeparateIds.includes('old-back-squat'),
        'a history link can be reversed and explicitly kept separate');
      t.setExerciseLink('old-back-squat', currentSquat.id);
      const normalized = t.normalizeRoutineItem({sets:2.9,reps:0,weight:-3});
      check(normalized.sets === 2 && normalized.repsMin === 0 && normalized.repsMax === 0 &&
        !('reps' in normalized) && normalized.weight === null, 'legacy routine target normalization');
      const ordered = t.normalizeRoutineItem({sets:3,repsMin:12,repsMax:8,targetRir:12});
      check(ordered.repsMin === 8 && ordered.repsMax === 12 && ordered.targetRir === 10,
        'rep range is ordered and target RIR is clamped');
      const old = {version:3, settings:{theme:'invalid',effortMetric:'invalid'}, exercises:[], routines:[{items:[{rest:60,sets:3,reps:5}]}],workouts:[{startedAt:1,exercises:[{restSeconds:60,sets:[{rpe:8}]}]}]};
      t.normalizeState(t.migrateState(old));
      check(old.version === 10 && Array.isArray(old.exerciseLinks) && Array.isArray(old.historySeparateIds) && Array.isArray(old.bodyweights) &&
        old.routines[0].items[0].repsMin === 5 && old.routines[0].items[0].repsMax === 5 &&
        old.settings.effortMetric === 'rpe' && old.settings.theme === 'system' && !('rest' in old.routines[0].items[0]) &&
        !('restSeconds' in old.workouts[0].exercises[0]), 'complete migration chain and settings fallback');
      const dirty = t.backupPayload();
      dirty.schemaVersion = '0.1.0'; dirty.source = 'old-exporter'; dirty.exportedAt = '2000-01-01T00:00:00.000Z';
      dirty.settings.unit = 'lb';
      dirty.exercises.find(ex => ex.unit === 'kg').unit = 'kg';
      const dirtyWorkout = dirty.workouts[0], dirtySet = dirtyWorkout.exercises[0].sets[0];
      dirtyWorkout.finishedAt = dirtyWorkout.startedAt - 1;
      Object.assign(dirtySet, {weight:-5,reps:-2.6,rpe:99,rir:-3,durationSeconds:-10,distance:-1,distanceUnit:'m'});
      const prepared = t.prepareBackup(dirty);
      const cleanSet = prepared.workouts[0].exercises[0].sets[0];
      check(!('schemaVersion' in prepared) && !('source' in prepared) && !('exportedAt' in prepared),
        'restore strips one-file transfer metadata from application state');
      check(prepared.exercises.filter(ex => ex.unit === 'kg' || ex.unit === 'lb').every(ex => ex.unit === 'lb'),
        'restore aligns weighted exercise definitions with the global unit');
      check(dirtyWorkout.finishedAt < dirtyWorkout.startedAt && prepared.workouts[0].finishedAt === prepared.workouts[0].startedAt &&
        cleanSet.weight === null && cleanSet.reps === 0 && cleanSet.rpe === 10 && cleanSet.rir === 0 &&
        cleanSet.durationSeconds === null && !('distance' in cleanSet) && !('distanceUnit' in cleanSet),
        'full restore enforces the same workout and set bounds as transfer import');
      t.state.schemaVersion = 'stale'; t.state.source = 'stale'; t.state.exportedAt = 'stale';
      const freshEnvelope = t.backupPayload();
      delete t.state.schemaVersion; delete t.state.source; delete t.state.exportedAt;
      check(freshEnvelope.schemaVersion === '1.8.0' && freshEnvelope.source === 'liftlog-web' && freshEnvelope.exportedAt !== 'stale',
        'fresh export metadata wins over stale state fields');
      t.setUnit('lb');
      check(t.state.exercises.filter(ex => ex.unit === 'kg' || ex.unit === 'lb').every(ex => ex.unit === 'lb'),
        'global unit change synchronizes every weighted exercise definition');
      t.setUnit('kg');
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
    await page.getByRole('button', {name:'Settings'}).click();
    await page.locator('[data-settings-section="transfer"] summary').click();
    await page.getByRole('button', {name:'Review exercise links', exact:true}).click();
    await page.getByRole('button', {name:'Show reviewed'}).click();
    const historyLinkSelect = page.locator('[data-change="history-link"][data-source="old-back-squat"]');
    assert.equal(await historyLinkSelect.inputValue(), 'ex-squat', 'review shows the saved historical link');
    assert.equal(await historyLinkSelect.locator('option[value="ex-plank"]').count(), 0,
      'manual history linking hides incompatible measurement kinds');
    await historyLinkSelect.selectOption('__separate');
    assert.equal(await page.evaluate(() => window.testAPI.canonicalExerciseId('old-back-squat')), 'old-back-squat',
      'review can undo a link and keep the series separate');
    await page.locator('[data-change="history-link"][data-source="old-back-squat"]').selectOption('ex-squat');
    assert.equal(await page.evaluate(() => window.testAPI.canonicalExerciseId('old-back-squat')), 'ex-squat',
      'review can relink a previously separated series');
    await page.evaluate(() => window.testAPI.state.exercises.reverse());
    await page.getByRole('button', {name:'Exercises', exact:true}).click();
    assert.deepEqual(await page.locator('#ex-list .list-name').allTextContents(), ['Back Squat','Leg Press','Plank'],
      'exercise list is alphabetical regardless of stored order');
    await page.getByRole('button', {name:'Routines'}).click();
    await page.getByRole('button', { name:'Edit Lower body', exact:true }).click();
    assert.equal(await page.getByLabel('Reps min').count(), 2, 'routine editor exposes lower rep targets');
    assert.equal(await page.getByLabel('Reps max').count(), 2, 'routine editor exposes upper rep targets');
    assert.equal(await page.getByLabel('Target RIR').count(), 3, 'routine editor exposes optional target RIR');
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
    assert.match(await page.locator('.ex-tags').innerText(), /target 3 × 5–8 @ 100 kg · RIR 2/,
      'active workout shows the full double-progression prescription');
    assert.equal(await page.getByLabel('Set 1 RIR').count(), 1,
      'a target RIR exposes the logging field even when global effort tracking is off');
    const activeWeight = page.locator('[data-bind="set"][data-field="weight"]').first();
    await activeWeight.fill('-5');
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].sets[0].weight),null,
      'active logging rejects a negative weight through the shared normalizer');
    await activeWeight.fill('100');
    const activeRir = page.getByLabel('Set 1 RIR');
    await activeRir.fill('15');
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].sets[0].rir),10,
      'active logging clamps RIR through the shared normalizer');
    await activeRir.fill('2');
    const activeEdit = await page.evaluate(() => {
      const t = window.testAPI;
      const def = t.state.exercises.find(ex => ex.id === 'ex-squat');
      const past = t.state.workouts.find(w => w.exercises.some(ex => ex.exerciseId === def.id));
      const pastBefore = past.exercises.find(ex => ex.exerciseId === def.id).name;
      t.ui.exerciseDraft = {...def, name:'Back Squat Updated', category:'Strength', notes:'Updated during session'};
      t.saveExerciseDraft();
      const active = t.state.activeWorkout.exercises.find(ex => ex.exerciseId === def.id);
      const pastAfter = past.exercises.find(ex => ex.exerciseId === def.id).name;
      const result = {name:active.name, category:active.category, notes:active.notes, pastBefore, pastAfter};
      t.ui.exerciseDraft = {...t.state.exercises.find(ex => ex.id === def.id),
        name:def.name, category:def.category, notes:def.notes, unit:def.unit};
      t.saveExerciseDraft();
      return result;
    });
    assert.deepEqual(activeEdit, {name:'Back Squat Updated', category:'Strength', notes:'Updated during session',
      pastBefore:'Back Squat', pastAfter:'Back Squat'},
      'exercise edits refresh the ongoing workout without rewriting History');
    assert.equal(await page.locator('#workout-title').innerText(), 'Back Squat',
      'restoring an exercise edit also refreshes the ongoing workout immediately');
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
    assert.equal(await page.evaluate(() => window.testAPI.state.version), 10, 'full backup restore migrates');
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.timer.remaining), 37, 'backup restore retains rest timer');
    await page.reload();
    assert.equal(await page.evaluate(() => window.testAPI.state.activeWorkout.exercises[0].name), 'Leg Press', 'settled workout survives reload');
    const progressionChecks = await page.evaluate(() => {
      const t = window.testAPI, check = (ok, label) => { if (!ok) throw Error(label); return label; };
      const make = (day, reps, weight = 100, opts = {}) => ({
        startedAt:day, exercises:[{ exerciseId:'lift', unit:opts.kind || 'kg', plannedSets:3,
          ...(opts.targetMax == null ? {} : {targetRepsMin:opts.targetMin || 5,targetRepsMax:opts.targetMax,targetRir:opts.targetRir}),
          sets:[...(opts.warmup ? [{completed:true, countForVolume:false, countForPR:false, unit:'kg', weight:50, reps:10}] : []),
            ...reps.map(r => ({completed:true, unit:opts.unit || 'kg', weight, reps:r,
              ...(opts.rir == null ? {} : {rir:opts.rir})}))] }]
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
      labels.push(check(t.progressionStatus('lift',[make(1,[8,8,8],100,{targetMax:8,targetRir:2,rir:2})]).ready,
        'upper target on every prescribed set at target RIR is ready for more load'));
      labels.push(check(!t.progressionStatus('lift',[make(1,[8,8,8],100,{targetMax:8,targetRir:2,rir:1})]).ready,
        'missing the target RIR does not advise a load increase'));
      const squat = t.state.exercises.find(ex => ex.name === 'Back Squat');
      t.state.workouts = a.map((w,i) => ({...w,id:'plateau-'+i,routineName:'Lower body',
        startedAt:Date.now() - (4-i)*86400000,finishedAt:Date.now() - (4-i)*86400000 + 1800000,
        exercises:w.exercises.map(ex => ({...ex,exerciseId:squat.id,name:squat.name,category:'Legs'}))})).reverse();
      t.ui.view = 'history'; t.render();
      return labels;
    });
    assert.equal(await page.locator('#progression-flags .progression-list li').count(), 1,
      'History shows one progression flag');
    assert.equal(await page.evaluate(() => {
      const flags = document.querySelector('#progression-flags');
      const chart = document.querySelector('[aria-label="Weekly volume, last 8 weeks"]');
      return !!(flags.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true, 'progression warnings precede the aggregate chart');
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
    await page.evaluate(() => {
      const ex = window.testAPI.state.workouts[0].exercises[0];
      ex.targetRepsMin = 5; ex.targetRepsMax = 8; ex.targetRir = 2;
      ex.sets.forEach(set => { set.reps = 8; set.rir = 2; });
      window.testAPI.render();
    });
    assert.equal(await page.locator('#progression-ready').count(), 1,
      'History shows a ready-to-increase cue after every prescribed set reaches the upper target');
    assert.match(await page.locator('#progression-ready').innerText(), /Increase load next time/);

    await page.getByRole('button', {name:'Settings'}).click();
    const bodyweightsBefore = await page.evaluate(() => window.testAPI.state.bodyweights.length);
    await page.getByLabel('Bodyweight (kg)').fill('82.5');
    await page.getByRole('button', {name:'Add entry'}).click();
    assert.equal(await page.evaluate(() => window.testAPI.state.bodyweights.length), bodyweightsBefore + 1,
      'Settings adds a dated bodyweight entry');
    await page.evaluate(() => {
      const t=window.testAPI;
      t.state.activeWorkout=null;
      t.state.exercises.push({id:'bw-ui',name:'Weighted Pull-up',category:'Back',unit:'bw',notes:'',url:''});
      t.state.routines.push({id:'bw-ui-routine',name:'Bodyweight test',items:[{id:'bw-ui-item',exerciseId:'bw-ui',sets:2,repsMin:5,repsMax:8,targetRir:2,weight:10}]});
      t.startRoutine('bw-ui-routine');
    });
    const addedLoad=page.getByLabel('Set 1 added load in kg');
    assert.equal(await addedLoad.inputValue(),'10','bodyweight routine target seeds added load');
    await addedLoad.fill('15');
    assert.deepEqual(await page.evaluate(() => {
      const set=window.testAPI.state.activeWorkout.exercises[0].sets[0];
      return {addedWeight:set.addedWeight,addedWeightUnit:set.addedWeightUnit,weight:set.weight};
    }),{addedWeight:15,addedWeightUnit:'kg',weight:null},'active bodyweight logging keeps added load distinct');
    await page.getByRole('button',{name:'Settings'}).click();
    const beforeClear = await page.evaluate(() => ({
      exercises:window.testAPI.state.exercises.length,
      routines:window.testAPI.state.routines.length,
      theme:window.testAPI.state.settings.theme,
      bodyweights:window.testAPI.state.bodyweights.length
    }));
    await page.locator('[data-settings-section="danger"] summary').click();
    await page.getByRole('button', {name:'Clear workout data…'}).click();
    await page.getByRole('dialog', {name:'Clear workout data?'}).getByRole('button', {name:'Clear workout data', exact:true}).click();
    await page.waitForFunction(() => window.testAPI.state.workouts.length === 0 && window.testAPI.state.activeWorkout === null);
    assert.deepEqual(await page.evaluate(() => ({
      exercises:window.testAPI.state.exercises.length,
      routines:window.testAPI.state.routines.length,
      theme:window.testAPI.state.settings.theme,
      bodyweights:window.testAPI.state.bodyweights.length,
      workouts:window.testAPI.state.workouts.length,
      active:window.testAPI.state.activeWorkout
    })), {...beforeClear,workouts:0,active:null}, 'clear workout data preserves library, routines and settings');

    const remoteChecks = await page.evaluate(async () => {
      const t=window.testAPI, checks=[];
      const check=(ok,label)=>{ if(!ok) throw Error(label); checks.push(label); };
      localStorage.setItem('liftlog.v1.remote',JSON.stringify({endpoint:'https://storage.test',bucket:'test',region:'test',accessKeyId:'test',secretAccessKey:'test',pathStyle:true}));
      t.state.settings.lastModifiedAt=1000;
      const remote=t.backupPayload();
      remote.settings.lastModifiedAt=2000;
      remote.routines[0].name='Remote newest';
      const requests=[];
      window.fetch=async (_url,options={})=>{
        requests.push(options.method || 'GET');
        return options.method === 'PUT' ? new Response('',{status:200}) :
          new Response(JSON.stringify(remote),{status:200,headers:{'content-type':'application/json'}});
      };
      await t.remoteStartupSync();
      check(t.state.routines[0].name==='Remote newest' && t.state.settings.lastModifiedAt===2000,
        'startup restores the newer remote snapshot');
      check(localStorage.getItem('liftlog.v1.before-remote-restore')!==null,
        'automatic restore preserves the replaced local state');
      const oldTheme=JSON.parse(localStorage.getItem('liftlog.v1')).settings.theme;
      t.state.settings.theme=oldTheme==='dark'?'light':'dark';
      t.save();
      check(JSON.parse(localStorage.getItem('liftlog.v1')).settings.theme===oldTheme,
        'ordinary saves are debounced off the input path');
      t.flushSave();
      check(JSON.parse(localStorage.getItem('liftlog.v1')).settings.theme===t.state.settings.theme,
        'a lifecycle flush persists a queued local save');
      await t.autoRemoteBackup();
      check(requests.includes('PUT'),'automatic backup uploads the current full snapshot');
      return checks;
    });

    const touch = await browser.newPage({ viewport:{width:320,height:568}, isMobile:true, hasTouch:true });
    touch.on('pageerror', e => errors.push(e.message));
    await touch.route('http://liftlog.test/**', route => route.fulfill({contentType:'text/html',body:html}));
    await touch.goto('http://liftlog.test/');
    assert.equal(await touch.evaluate(() => {
      const nav = document.querySelector('#nav-list');
      const settings = document.querySelector('[data-view="settings"]');
      const r = settings.getBoundingClientRect();
      return nav.scrollWidth <= nav.clientWidth && r.left >= 0 && r.right <= innerWidth &&
        [...nav.querySelectorAll('.nav-btn')].every(button => button.scrollWidth <= button.clientWidth);
    }), true, 'all five primary tabs fit at 320px');
    assert.equal(await touch.getByRole('button', {name:'Exercises', exact:true}).count(), 1,
      'primary navigation uses the Exercises label');
    assert.equal(await touch.getByText('Tip: press').evaluate(el => getComputedStyle(el).display), 'none',
      'keyboard tip is hidden on touch');
    assert.equal(await touch.locator('.app-footer').evaluate(el => getComputedStyle(el).display), 'none',
      'keyboard-help footer is hidden on touch');
    await touch.getByRole('button', {name:'Settings'}).click();
    assert.equal(await touch.locator('[aria-label="Keyboard shortcuts"]').evaluate(el => getComputedStyle(el).display), 'none',
      'shortcut table is hidden on touch');
    assert.deepEqual(await touch.locator('.settings-disclosure').evaluateAll(nodes => nodes.map(node => node.open)), [false,false,false],
      'secondary data controls are collapsed in mobile Settings');
    await touch.locator('[data-settings-section="transfer"] summary').click();
    assert.equal(await touch.locator('[data-settings-section="transfer"]').evaluate(node => node.open), true,
      'mobile Settings disclosures open on demand');
    await touch.screenshot({path:'/tmp/liftlog-settings-mobile.png',fullPage:true});
    await touch.getByRole('button', {name:'History', exact:true}).click();
    assert.equal(await touch.locator('.stats').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2,
      'history summary stays a two-column grid at 320px');
    assert.equal(await touch.getByText('Workout time · 30 days').count(), 1,
      'workout-duration summary uses an accurate label');
    await touch.evaluate(() => {
      const w = {id:'mobile-orphan',routineId:null,routineName:'Imported',startedAt:Date.now(),finishedAt:Date.now()+60000,notes:'',
        exercises:[{exerciseId:'mobile-old-id',name:'Old Cable Row',category:'Back',unit:'kg',plannedSets:1,
          sets:[{id:'mobile-old-set',weight:40,reps:10,completed:true,unit:'kg'}]}]};
      window.testAPI.importHistory(new File([JSON.stringify({workouts:[w]})],'mobile-history.json',{type:'application/json'}));
    });
    await touch.waitForFunction(() => window.testAPI.ui.importSummary?.added === 1);
    await touch.getByRole('button', {name:'Review exercise links'}).click();
    assert.equal(await touch.locator('[data-change="history-link"][data-source="mobile-old-id"]').count(), 1,
      'duplicate-safe import can open exercise reconciliation');
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      'exercise reconciliation fits at 320px');
    assert.match(await touch.locator('#routine-pair-dlg .desc').innerText(), /Completing either one removes the other/,
      'either-of dialog describes in-session completion behavior');
    await touch.close();
    assert.deepEqual(errors, []);
    console.log([...result, ...progressionChecks, ...remoteChecks, 'clear workout data preserves library, routines and settings',
      'mobile editor pairing and in-session alternative completion', 'History progression flag and navigation',
      'no browser errors'].map(s => 'PASS ' + s).join('\n'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

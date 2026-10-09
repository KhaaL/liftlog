// Workflow regression suite: `npm test`, or node tests/regression.cjs. See tests/README.md.
const assert = require('node:assert/strict');
const { appWithTestAPI, launchBrowser } = require('./harness.cjs');
(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport:{ width:390, height:844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const html = appWithTestAPI(`{ sampleRoutinesFile, sampleHistoryFile, routinesPayload, historyPayload, backupPayload, applyFullBackup, prepareBackup, validateBackup, importRoutines, planRoutineImport, applyRoutineImport, exerciseNameKey, exerciseNameSimilarity, sameLoadNumbers, distinctExerciseName, linksBrokenBy, sortedPlans, planDay, defaultRoutineId, newPlanDraft, localDay, importHistory, normalizeImportedSet, normalizeImportedWorkout, migrateState, normalizeState, defaultSettings, normalizeRoutineItem, cleanRoutinePairs, keepRoutinePairsAdjacent, routineGroups, routineSummary, workoutSets, workoutPlannedSets, workoutVolume, progressionStatus, loadCueFor, pairRoutineItems, unpairRoutineItems, duplicateRoutine, removeRoutineItem, saveRoutineDraft, saveExerciseDraft, startRoutine, toggleSet, toggleWarmup, cascadeWeight, cascadeReps, parseRepRange, repRangeState, setUnit, htmlRoutineEditor, trendCandidates, exSessions, canonicalExerciseId, unresolvedHistoryExercises, compatibleHistoryLink, setExerciseLink, keepHistoricalExerciseSeparate, addHistoricalExerciseToLibrary, setExerciseArchived, mergeExercises, sameProgressionContract, exerciseLoadLabel, setSummary, remoteStartupSync, autoRemoteBackup, flushSave, save, render, supersetRun, currentMemberIndex, isSettledRow, switchSupersetMember, moveSessionExercise, nextOpenBlock, pairSessionExercises, unpairSessionExercises, reopenExercise, navigate, currentExercise, settleSupersets, pauseTimer, finishWorkout, sampleExercises, sampleRoutines, get timer(){return timer}, get state(){return state}, get ui(){return ui} }`);
    await page.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await page.goto('https://liftlog.test/');
    const result = await page.evaluate(async () => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const file = obj => new File([JSON.stringify(obj)], 'sample.json', {type:'application/json'});
      const wait = () => new Promise(r => setTimeout(r, 60));
      t.state.exercises = []; t.state.routines = []; t.state.workouts = [];
      const sample = t.sampleRoutinesFile();
      check(sample.version === 14 && sample.schemaVersion === '1.12.0', 'sample version markers');
      t.importRoutines(file(sample)); await wait();
      check(t.state.routines.length === 2 && t.state.exercises.length === 5, 'routine sample imports all definitions');
      check(t.state.routines[1].plan === true && /^\d{4}-\d{2}-\d{2}$/.test(t.state.routines[1].plannedFor) && !('plan' in t.state.routines[0]),
        'the sample plan imports as a plan and the routine stays stable');
      const r = t.state.routines[0];
      check(r.id === 'rt-lower' && t.state.exercises.some(ex => ex.id === 'ex-squat'),
        'routine import preserves safe source identities');
      const groups = t.routineGroups(r.items);
      check(groups.length === 3 && groups[0].length === 2 && groups[0].every(it => it.eitherOf) &&
        groups[1].length === 2 && groups[1].every(it => it.supersetOf), 'sample either-of pair and superset survive import');
      check(r.items[0].repsMin === 5 && r.items[0].repsMax === 8 && r.items[0].targetRir === 2,
        'routine sample preserves rep range and target RIR');
      t.importRoutines(file(sample)); await wait();
      check(t.state.routines.length === 2, 'routine import deduplicates');
      /* The pair checks below were written against the either-of routine alone;
         supersets have their own section. Dropping the sample's superset keeps
         their counts about the pair. */
      r.items = r.items.filter(it => !it.supersetOf);
      t.state.exercises = t.state.exercises.filter(ex => ex.id !== 'ex-leg-curl' && ex.id !== 'ex-calf-raise');
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
        exercises:[{ exerciseId:'old-back-squat', name:'Back Squat', category:'Legs', movementFamily:'squat', unit:'kg', loadMode:'total', equipmentKey:'olympic-bar',
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
      check(old.version === 14 && Array.isArray(old.exerciseLinks) && Array.isArray(old.historySeparateIds) && Array.isArray(old.bodyweights) && Array.isArray(old.progressionPreferences) &&
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
      check(freshEnvelope.schemaVersion === '1.12.0' && freshEnvelope.source === 'liftlog-web' && freshEnvelope.exportedAt !== 'stale',
        'fresh export metadata wins over stale state fields');
      t.setUnit('lb');
      check(t.state.exercises.filter(ex => ex.unit === 'kg' || ex.unit === 'lb').every(ex => ex.unit === 'lb'),
        'global unit change synchronizes every weighted exercise definition');
      check(t.state.settings.loadStep === 5, 'the default load step follows the unit (2.5 kg → 5 lb)');
      t.setUnit('kg');
      check(t.state.settings.loadStep === 2.5, 'and back (5 lb → 2.5 kg)');
      t.state.settings.loadStep = 4; t.setUnit('lb');
      check(t.state.settings.loadStep === 9, 'a custom step is converted');
      t.setUnit('kg'); t.state.settings.loadStep = 2.5;
      const badStep = {version:13, settings:{unit:'lb', loadStep:-3}, exercises:[], routines:[], workouts:[]};
      t.normalizeState(t.migrateState(badStep));
      check(badStep.settings.loadStep === 5, 'an invalid stored step falls back to the unit default');
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
      const mergeSource = {...currentSquat,id:'old-current-squat',name:'Back Squat old',archived:true};
      t.state.exercises.push(mergeSource);
      t.state.routines.push({id:'merge-routine',name:'Merge test',items:[{id:'merge-item',exerciseId:mergeSource.id,sets:3,repsMin:5,repsMax:8}]});
      t.state.workouts.push({id:'merge-history',routineName:'Old squat',startedAt:3,finishedAt:4,notes:'',exercises:[{
        exerciseId:mergeSource.id,name:mergeSource.name,category:mergeSource.category,unit:mergeSource.unit,
        loadMode:mergeSource.loadMode,equipmentKey:mergeSource.equipmentKey,movementFamily:mergeSource.movementFamily,
        sets:[{id:'merge-set',weight:90,reps:5,completed:true,unit:'kg'}]
      }]});
      check(t.mergeExercises(mergeSource.id,currentSquat.id) === '' &&
        !t.state.exercises.some(ex => ex.id === mergeSource.id) &&
        t.state.routines.find(x => x.id === 'merge-routine').items[0].exerciseId === currentSquat.id &&
        t.state.workouts.find(x => x.id === 'merge-history').exercises[0].exerciseId === mergeSource.id &&
        t.canonicalExerciseId(mergeSource.id) === currentSquat.id,
        'merge rewrites live references, preserves finished snapshots and joins analytics');
      check(t.exerciseLoadLabel({...currentSquat,loadMode:'per_hand'}) === 'kg/hand' &&
        t.setSummary({weight:20,reps:8,unit:'kg'},{...currentSquat,loadMode:'per_hand'}) === '20 kg/hand × 8',
        'per-hand exercises display their load convention in planning and history');
      check(!t.sameProgressionContract({...currentSquat,loadMode:'per_hand'}, currentSquat) &&
        !t.sameProgressionContract({...currentSquat,loadMode:'machine_stack',equipmentKey:'machine-a'},
          {...currentSquat,loadMode:'machine_stack',equipmentKey:'machine-b'}),
        'progression series reject incompatible load modes and equipment');
      return checks;
    });
    await page.getByRole('button', {name:'Settings'}).click();
    await page.locator('[data-settings-section="transfer"] summary').click();
    await page.getByRole('button', {name:'Review progression series', exact:true}).click();
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
    await page.locator('#ex-list .ex-row').filter({hasText:'Leg Press'}).locator('.list-open').click();
    const legPressSheet = page.getByRole('dialog', {name:'Leg Press'});
    await legPressSheet.getByRole('button', {name:'Archive Leg Press'}).click();
    assert.equal(await legPressSheet.getByRole('button', {name:'Restore Leg Press'}).count(), 1,
      'archiving from the sheet keeps it open and offers Restore');
    await legPressSheet.getByRole('button', {name:'Close exercise'}).click();
    assert.equal(await page.locator('#ex-list .ex-row').filter({hasText:'Leg Press'}).count(), 0,
      'archived exercises leave the normal Exercises view');
    await page.getByRole('button', {name:/Show archived/}).click();
    assert.equal(await page.locator('#ex-list .ex-row').filter({hasText:'Leg Press'}).count(), 1,
      'archived exercises can be reviewed and restored');
    await page.getByRole('button', {name:'Routines'}).click();
    await page.getByRole('button', {name:'Lower body', exact:true}).click();
    await page.getByRole('button', { name:'Edit Lower body', exact:true }).click();
    assert.equal(await page.locator('#routine-add-select option', {hasText:'Leg Press'}).count(), 0,
      'routine picker only offers active exercises');
    const rangeFields = page.locator('#routine-form [data-field="repRange"]');
    assert.equal(await rangeFields.count(), 3, 'routine editor takes each rep target as one range field');
    assert.match(await rangeFields.first().inputValue(), /^\d+(–\d+)?$/, 'the range field shows the saved target');
    await rangeFields.first().fill('12 to 8');
    assert.equal(await rangeFields.first().evaluate(el => el.checkValidity()), true, 'a written-out range is accepted');
    await rangeFields.first().fill('8-');
    assert.equal(await rangeFields.first().evaluate(el => el.checkValidity()), false, 'a half-typed range does not save');
    await rangeFields.first().fill('8 – 5');   // reordered on save; the workout below expects 5–8
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
      t.ui.exerciseDraft = {...def, name:'Back Squat Updated', category:'Push', notes:'Updated during session'};
      t.saveExerciseDraft();
      const active = t.state.activeWorkout.exercises.find(ex => ex.exerciseId === def.id);
      const pastAfter = past.exercises.find(ex => ex.exerciseId === def.id).name;
      const result = {name:active.name, category:active.category, notes:active.notes, pastBefore, pastAfter};
      t.ui.exerciseDraft = {...t.state.exercises.find(ex => ex.id === def.id),
        name:def.name, category:def.category, notes:def.notes, unit:def.unit};
      t.saveExerciseDraft();
      return result;
    });
    assert.deepEqual(activeEdit, {name:'Back Squat Updated', category:'Push', notes:'Updated during session',
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
    assert.equal(workout.exercises[1].sets[0].durationSeconds, null, 'a planned timed set starts blank');
    assert.equal(workout.exercises[1].targetRepsMin, 45, 'its target stays on the exercise as the hint');
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
    assert.equal(await page.evaluate(() => window.testAPI.state.version), 14, 'full backup restore migrates');
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
    assert.match(await page.locator('[aria-label="Exercise trend"] .trend-foot').innerText(), /No change/,
      'flat strength trend is neutral rather than a green gain');
    assert.match(await page.locator('[aria-label="Exercise trend"] .records').innerText(), /No new best since the first session/,
      'a flat series reports no record after its baseline');
    await page.getByRole('button', {name:'Working sets'}).click();
    assert.equal(await page.locator('[aria-label="Weekly working sets, last 8 weeks"] [aria-pressed="true"]').innerText(), 'Working sets',
      'the weekly chart switches to working sets');
    assert.match(await page.locator('.weekly-foot').innerText(), /12 sets in the last 4 weeks vs 0 sets in the 4 before/,
      'the weekly foot compares the last four weeks with the four before');
    await page.getByRole('button', {name:'Volume', exact:true}).click();
    assert.equal(await page.locator('[aria-label="Weekly volume, last 8 weeks"]').count(), 1, 'and back to volume');
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
    assert.equal(await page.locator('[aria-label="Exercise trend"] .records-list li').count(), 1,
      'the session that beat its predecessors is listed as a record');
    assert.equal(await page.locator('[aria-label="Exercise trend"] circle[data-record]').count(), 2,
      'the baseline and the record are the filled dots on the trend');
    const trendChart = page.locator('.trend-chart');
    await trendChart.scrollIntoViewIfNeeded();
    const tBox = await trendChart.boundingBox();
    await page.mouse.move(tBox.x + tBox.width - 4, tBox.y + tBox.height / 2);
    const tip = page.locator('.trend-tip');
    assert.equal(await tip.isVisible() && !(await tip.evaluate(el => el.classList.contains('is-pinned'))), true,
      'hovering the trend previews the nearest session');
    assert.match(await tip.innerText(), /new best[\s\S]*Best set: 100 kg × 9[\s\S]*3 sets: 100 kg × 9, 100 kg × 8, 100 kg × 8/,
      'the card names the best set and every completed set of that session');
    await page.mouse.move(tBox.x + 4, tBox.y + tBox.height / 2);
    assert.match(await tip.innerText(), /First session logged/, 'moving along the line follows the nearest session');
    await page.mouse.move(tBox.x + tBox.width / 2, tBox.y - 60);
    assert.equal(await tip.isVisible(), false, 'leaving the chart hides the preview');
    await trendChart.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    assert.match(await tip.innerText(), /Same as/, 'the arrow keys step through sessions');
    assert.equal(await tip.getByRole('button', {name:'Open session'}).isVisible(), true, 'a pinned card offers the session');
    await page.keyboard.press('Escape');
    assert.equal(await tip.isVisible(), false, 'Escape closes the card');
    await page.mouse.click(tBox.x + tBox.width - 4, tBox.y + tBox.height / 2);
    await tip.getByRole('button', {name:'Open session'}).click();
    assert.equal(await page.evaluate(() => document.querySelector('#detail-dlg').open &&
      window.testAPI.ui.detail.id === window.testAPI.state.workouts[0].id), true,
      'Open session opens that workout in its sheet');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#detail-dlg').open);
    await page.evaluate(() => {
      const ex = window.testAPI.state.workouts[0].exercises[0];
      ex.targetRepsMin = 5; ex.targetRepsMax = 8; ex.targetRir = 2;
      ex.sets.forEach(set => { set.reps = 8; set.rir = 2; });
      window.testAPI.render();
    });
    assert.equal(await page.locator('#progression-ready').count(), 0,
      'History no longer opens with ready-to-increase notifications');
    await page.locator('[data-progression-analysis] summary').click();
    assert.match(await page.locator('.cue-manager').innerText(), /Ready to increase load/,
      'historical load results remain available in progression analysis');
    await page.evaluate(() => {
      const t = window.testAPI, squat = t.state.exercises.find(ex => ex.name === 'Back Squat');
      const latest = Date.now() - 60000;
      t.state.workouts = [{id:'cue-session',routineName:'Cue workout',startedAt:latest,finishedAt:latest+30000,
        exercises:[
          {exerciseId:squat.id,name:squat.name,unit:'kg',loadMode:squat.loadMode,
            equipmentKey:squat.equipmentKey,movementFamily:squat.movementFamily,plannedSets:3,
            targetRepsMin:5,targetRepsMax:8,targetRir:null,
            sets:[1,2,3].map(i => ({id:'cue-set-'+i,completed:true,unit:'kg',weight:100,reps:8}))},
          {exerciseId:'historic-only',name:'Historic only',unit:'kg',loadMode:'total',plannedSets:1,
            targetRepsMin:5,targetRepsMax:8,targetRir:null,
            sets:[{id:'historic-set',completed:true,unit:'kg',weight:40,reps:8}]}
        ]}];
      t.state.activeWorkout = null;
      t.state.routines.push({id:'cue-routine',name:'Cue routine',items:[
        {id:'cue-item',exerciseId:squat.id,sets:3,repsMin:5,repsMax:8,targetRir:2,weight:100}]});
      t.ui.selectedRoutineId='cue-routine'; t.ui.view='today'; t.render();
    });
    assert.equal(await page.locator('.today-cues .cue-table tbody tr:not(.cue-actions-row)').count(), 0,
      'current routine target RIR prevents a cue when latest sets have no RIR');
    await page.evaluate(() => { const t=window.testAPI;
      t.state.routines.find(r => r.id==='cue-routine').items[0].targetRir=null; t.render(); });
    assert.match(await page.locator('.today-cues').innerText(), /Reps met — check technique and 1–2 RIR first/,
      'missing target RIR gets a rep cue and technique check rather than an unconditional load increase');
    assert.match(await page.locator('.today-cues .cue-next').innerText(), /^102\.5 kg × 5$/,
      'next load is the last load plus the step, at the bottom of the rep range');
    assert.equal(await page.locator('.today-cues .cue-date').last().innerText(), await page.evaluate(() => {
      const d = new Date(window.testAPI.state.workouts[0].startedAt);
      return String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }), 'the last result is dated MM-DD');
    await page.getByRole('button', {name:'Settings'}).click();
    await page.locator('#load-step').fill('5');
    await page.locator('#load-step').press('Tab');
    await page.getByRole('button', {name:'Today', exact:true}).click();
    assert.match(await page.locator('.today-cues .cue-next').innerText(), /^105 kg × 5$/, 'the step comes from Settings');
    assert.equal(await page.locator('.today-cues [data-action="cue-dismiss"]').count(), 0, 'row actions start hidden');
    await page.locator('.today-cues [data-action="cue-menu"]').click();
    assert.equal(await page.locator('.today-cues [data-action="cue-menu"]').getAttribute('aria-expanded'), 'true', 'the row menu opens');
    await page.locator('.today-cues [data-action="cue-dismiss"]').click();
    assert.equal(await page.locator('.today-cues .cue-table tbody tr:not(.cue-actions-row)').count(), 0,
      'dismissing hides the current exposure');
    assert.equal(await page.evaluate(() => window.testAPI.prepareBackup(window.testAPI.backupPayload())
      .progressionPreferences.some(pref => pref.exerciseId==='ex-squat' && pref.dismissedExposureKey)), true,
      'dismissal survives a full backup round trip');
    await page.evaluate(() => { const t=window.testAPI;
      const next=structuredClone(t.state.workouts[0]); next.id='cue-session-2'; next.startedAt+=1000;
      next.exercises[0].sets.forEach((set,i) => {set.id='cue-set-new-'+i;});
      next.exercises[1].sets[0].id='historic-set-new';
      t.state.workouts.unshift(next); t.render(); });
    assert.equal(await page.locator('.today-cues .cue-table tbody tr:not(.cue-actions-row)').count(), 1,
      'a new exposure restores the dismissed cue');
    await page.locator('.today-cues [data-action="cue-menu"]').click();
    await page.locator('.today-cues [data-action="cue-off"]').click();
    assert.equal(await page.locator('.today-cues .cue-table tbody tr:not(.cue-actions-row)').count(), 0,
      'turning suggestions off hides the routine cue');
    await page.getByRole('button', {name:'History', exact:true}).click();
    if (!await page.locator('[data-progression-analysis]').evaluate(el => el.open))
      await page.locator('[data-progression-analysis] summary').click();
    const historicRow=page.locator('.cue-manager-list li').filter({hasText:'Historic only'});
    await historicRow.getByRole('button', {name:'Turn off load suggestions'}).click();
    assert.match(await historicRow.innerText(), /Suggestions off/,
      'historical IDs without library definitions can disable suggestions');
    assert.equal(await page.evaluate(() => {
      const t=window.testAPI;
      return t.historyPayload(t.state.workouts,t.state.exerciseLinks,t.state.historySeparateIds,
        t.state.bodyweights,t.state.progressionPreferences).progressionPreferences
        .some(pref => pref.exerciseId==='historic-only' && pref.loadCuesOff);
    }), true, 'history transfer carries disabled historical-series suggestions');
    await historicRow.getByRole('button', {name:'Turn on load suggestions'}).click();
    assert.match(await historicRow.innerText(), /Rep target met/,
      'historical series can enable suggestions again');
    const squatRow=page.locator('.cue-manager-list li').filter({hasText:'Back Squat'});
    await squatRow.getByRole('button', {name:'Turn on load suggestions'}).click();
    await page.getByLabel('Find an exercise or session').fill('Historic only');
    assert.equal(await page.locator('.hist-row').count(), 2,
      'History exercise search finds sessions by exercise snapshot');
    await page.getByLabel('Find an exercise or session').fill('no matching exercise');
    assert.equal(await page.locator('.hist-row').count(), 0,
      'History search filters unmatched workouts');
    await page.locator('.cue-manager-list li').filter({hasText:'Back Squat'})
      .getByRole('button', {name:'View last session'}).click();
    assert.equal(await page.locator('.hist-ex.is-highlighted').count(), 1,
      'View last session opens the exact workout exercise');
    assert.equal(await page.locator('.hist-ex.is-highlighted h4').innerText().then(s => s.startsWith('Back Squat')), true,
      'the highlighted block is the cue source exercise');
    assert.equal(await page.evaluate(() => {
      const el = document.activeElement;
      return !!el && el.classList.contains('is-highlighted') && !!el.closest('#detail-dlg[open]');
    }), true, 'View last session opens that workout in its sheet, focused on the exercise');
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name:'Today', exact:true}).click();
    await page.getByRole('button', {name:'Start Cue routine'}).click();
    assert.equal(await page.locator('.load-cue.is-compact').count(), 1,
      'active workout shows the cue beside load entry');

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

    /* Supersets: the shared pair rules, the group cursor, rest per round, and
       the session-only lifetime of the link. A fresh page so earlier steps
       cannot leak in. */
    const ss = await browser.newPage({ viewport:{ width:390, height:844 } });
    ss.on('pageerror', e => errors.push(e.message));
    await ss.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await ss.goto('https://liftlog.test/');
    const supersetUnits = await ss.evaluate(async () => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const three = [{exerciseId:'a',supersetOf:'s'}, {exerciseId:'b',supersetOf:'s'}, {exerciseId:'c',supersetOf:'s'}];
      t.cleanRoutinePairs(three);
      check(three.every(it => !it.supersetOf), 'oversized supersets become independent');
      const same = [{exerciseId:'a',supersetOf:'s'}, {exerciseId:'a',supersetOf:'s'}];
      t.cleanRoutinePairs(same);
      check(same.every(it => !it.supersetOf), 'a superset needs two different exercises');
      const both = [{exerciseId:'a',eitherOf:'e',supersetOf:'s'}, {exerciseId:'b',eitherOf:'e'}, {exerciseId:'c',supersetOf:'s'}];
      t.cleanRoutinePairs(both);
      check(both[0].eitherOf === 'e' && both[1].eitherOf === 'e' && both.every(it => !it.supersetOf),
        'an item in both kinds keeps either-of and orphans the superset');
      const shared = [{exerciseId:'a',eitherOf:'k'}, {exerciseId:'b',eitherOf:'k'}, {exerciseId:'c',supersetOf:'k'}, {exerciseId:'d',supersetOf:'k'}];
      t.cleanRoutinePairs(shared);
      check(t.routineGroups(shared).length === 2, 'either-of and superset keys never join each other');
      check(t.routineSummary([{exerciseId:'a',sets:3,supersetOf:'s'}, {exerciseId:'b',sets:2,supersetOf:'s'}, {exerciseId:'c',sets:2}]) ===
        '3 exercises · 7 planned sets', 'superset summary counts both members and adds their sets');
      t.ui.routineDraft = { id:null, name:'Draft', items:[
        {id:'i1',exerciseId:'ex-a',sets:3,repsMin:8,repsMax:8},
        {id:'i2',exerciseId:'ex-c',sets:2,repsMin:8,repsMax:8},
        {id:'i3',exerciseId:'ex-b',sets:2,repsMin:8,repsMax:8}] };
      check(t.pairRoutineItems('i1', 'i3', 'supersetOf') && t.ui.routineDraft.items.map(it => it.id).join() === 'i1,i3,i2',
        'creating a superset moves its members together');
      check(!t.pairRoutineItems('i1', 'i2', 'eitherOf'), 'a superset member cannot also be paired');
      t.unpairRoutineItems(t.ui.routineDraft.items[0].supersetOf);
      check(!t.ui.routineDraft.items.some(it => it.supersetOf), 'splitting removes both superset keys');
      t.ui.routineDraft = null;

      t.state.workouts = []; t.state.activeWorkout = null;
      t.state.exercises = [
        {id:'ex-a',name:'Bench',category:'Push',unit:'kg',notes:'',archived:false},
        {id:'ex-b',name:'Row',category:'Pull',unit:'kg',notes:'',archived:false},
        {id:'ex-c',name:'Plank',category:'Core',unit:'time',notes:'',archived:false}];
      t.state.routines = [{id:'rt-ss',name:'Upper',items:[
        {id:'s1',exerciseId:'ex-a',sets:3,repsMin:8,repsMax:8,weight:60,supersetOf:'ss'},
        {id:'s2',exerciseId:'ex-b',sets:2,repsMin:8,repsMax:8,weight:50,supersetOf:'ss'},
        {id:'s3',exerciseId:'ex-c',sets:1,repsMin:30,repsMax:30}]}];
      const payload = structuredClone(t.routinesPayload(t.state.exercises, t.state.routines));
      check(payload.routines[0].items[0].supersetOf === 'ss', 'routine export carries the superset key');
      payload.routines[0].id = 'rt-ss-copy'; payload.routines[0].name = 'Upper copy';
      t.importRoutines(new File([JSON.stringify(payload)], 'r.json', {type:'application/json'}));
      await new Promise(r => setTimeout(r, 60));
      const copy = t.state.routines.find(r => r.name === 'Upper copy');
      check(copy && copy.items[0].supersetOf && copy.items[0].supersetOf === copy.items[1].supersetOf,
        'routine import preserves the superset');
      t.state.routines = t.state.routines.filter(r => r !== copy);
      const legacy = t.backupPayload(); legacy.version = 12;
      check(t.prepareBackup(legacy).version === 14, 'v12 data migrates to v14 unchanged');

      t.state.settings.autoRest = true;
      const resting = () => { const on = t.timer.running; t.pauseTimer(); t.timer.remaining = 0; return on; };
      t.startRoutine('rt-ss');
      const w = t.state.activeWorkout;
      check(w.exercises[0].supersetOf === w.exercises[1].supersetOf && w.currentExerciseIndex === 0 && w.supersetSide === 0,
        'a started routine opens on the first superset member');
      check(t.workoutPlannedSets(w) === 6, 'planned sets count every superset member');
      const log = () => t.toggleSet(t.currentExercise().sets.find(s => !s.completed).id);
      log();
      check(t.currentExercise().name === 'Row' && w.currentExerciseIndex === 0 && w.supersetSide === 1 && !resting(),
        'a set on the first member hands over to the partner without rest');
      check(t.isSettledRow(w, w.exercises[0], 0) === false, 'the waiting member is not treated as settled');
      log();
      check(t.currentExercise().name === 'Bench' && resting(), 'finishing the round rests and returns to the first member');
      log(); log();
      check(t.currentExercise().name === 'Bench' && resting() && w.exercises[1].sets.every(s => s.completed),
        'with the partner finished the remaining sets run straight, with rest');
      t.validateBackup(t.backupPayload());
      const reloaded = t.prepareBackup(t.backupPayload()).activeWorkout;
      check(reloaded.supersetSide === 0 && reloaded.exercises[0].supersetOf, 'the group cursor survives a save and reload');
      log();
      check(t.currentExercise().name === 'Plank' && w.currentExerciseIndex === 2, 'finishing both members moves past the superset');
      t.state.activeWorkout = null;
      t.startRoutine('rt-ss');
      const w2 = t.state.activeWorkout;
      t.switchSupersetMember(1);
      check(t.currentExercise().name === 'Row', 'the switcher selects the other member');
      t.state.activeWorkout.exercises.splice(2, 0, t.state.activeWorkout.exercises.splice(1, 1)[0]);
      check(t.settleSupersets(w2) && !w2.exercises.some(ex => ex.supersetOf), 'separated members end the superset for this session');
      check(t.state.routines[0].items[0].supersetOf === 'ss', 'the saved routine keeps its superset');
      t.state.activeWorkout = null;
      t.startRoutine('rt-ss');
      t.state.activeWorkout.exercises[0].sets.forEach(s => { s.completed = true; });
      t.state.activeWorkout.exercises[1].sets[0].completed = true;
      const finishedShape = structuredClone(t.state.activeWorkout);
      t.state.workouts.push(finishedShape); finishedShape.id = 'fin'; finishedShape.finishedAt = finishedShape.startedAt + 1;
      const restored = t.prepareBackup(t.backupPayload());
      check(!restored.workouts[0].exercises.some(ex => 'supersetOf' in ex) && !('supersetSide' in restored.workouts[0]),
        'finished workouts do not keep superset data');
      t.state.activeWorkout = null;
      t.startRoutine('rt-ss');
      const bench = t.currentExercise();
      t.toggleWarmup(bench.sets[0].id);
      t.toggleSet(bench.sets[0].id);
      check(t.currentExercise() === bench && resting(), 'a superset warm-up stays on its exercise and rests like a straight set');
      t.toggleSet(bench.sets[1].id);
      check(t.currentExercise().name === 'Row' && !resting(), 'the first working set after a warm-up hands over as usual');
      t.state.activeWorkout = null;
      t.startRoutine('rt-ss');
      const fresh = t.currentExercise();
      check(fresh.sets.every(s => s.reps == null), 'planned sets start with a blank count');
      fresh.sets[2].weight = null; fresh.sets[1].reps = 7;
      t.cascadeWeight(fresh.sets[0].id, 40);
      check(fresh.sets.map(s => s.weight).join() === '40,60,40', 'a weight cascades only into blank later rows');
      t.cascadeReps(fresh.sets[0].id, 5);
      check(fresh.sets.map(s => s.reps).join() === '5,7,5', 'reps cascade only into blank later rows');
      fresh.sets[2].reps = null;
      t.toggleSet(fresh.sets[2].id);
      check(fresh.sets[2].reps === 8, 'logging an untouched set records the lower target');
      const ranged = { unit:'kg', targetRepsMin:8, targetRepsMax:12 };
      check(t.repRangeState(ranged, {reps:7}).cls === 'reps-under' && t.repRangeState(ranged, {reps:13}).cls === 'reps-over' &&
        t.repRangeState(ranged, {reps:10}) === null && t.repRangeState(ranged, {reps:null}) === null &&
        t.repRangeState(ranged, {reps:3, countForVolume:false, countForPR:false}) === null,
        'logged counts are marked against the range, warm-ups excepted');
      check(JSON.stringify(['8', '8-12', '12–8', '8 to 12', ' 6 — 10 ', '8-', 'x', ''].map(t.parseRepRange)) ===
        JSON.stringify([{min:8,max:8}, {min:8,max:12}, {min:8,max:12}, {min:8,max:12}, {min:6,max:10}, null, null, null]),
        'the editor parses a count or a range in any common spelling');
      const seedExs = t.sampleExercises();
      const seedRoutines = t.sampleRoutines(seedExs);
      const [seedUpper, seedLower] = seedRoutines;
      const seedSuperset = t.routineGroups(seedUpper.items).find(g => g.length === 2 && g[0].supersetOf);
      check(!!seedSuperset && seedSuperset.map(it => seedExs.find(e => e.id === it.exerciseId).name).sort().join(',') ===
        'Bicep Curl Machine,Triceps Extension Machine', 'the seeded Upper Body routine supersets biceps and triceps');
      const seedEither = t.routineGroups(seedLower.items).find(g => g.length === 2 && g[0].eitherOf);
      check(!!seedEither && seedEither.map(it => seedExs.find(e => e.id === it.exerciseId).name).sort().join(',') ===
        'Leg Extension Machine,Leg Press Machine', 'the seeded Lower Body routine offers leg press or leg extension');
      check(t.routineSummary(seedUpper.items) === '6 exercises · 15 planned sets', 'seeded superset counts both members in the routine summary');
      t.state.workouts = [];
      return checks;
    });
    await ss.evaluate(() => { const t = window.testAPI; t.state.activeWorkout = null; t.startRoutine('rt-ss'); t.render(); });
    assert.match(await ss.locator('.superset-note').innerText(), /Superset with\s*Row/, 'workout panel names the superset partner');
    await ss.locator('#ss-switch-1').click();
    assert.equal(await ss.locator('#workout-title').innerText(), 'Row', 'switch button changes the member on screen');
    await ss.locator('#overview-toggle-btn').click();
    assert.equal(await ss.evaluate(() => {
      const rows = [...document.querySelectorAll('#overview-dlg-body .overview-row')];
      return rows.length === 3 && rows[0].classList.contains('superset-first') &&
        rows[1].classList.contains('superset-last') && rows[1].classList.contains('is-current-row') &&
        getComputedStyle(rows[1], '::after').content === '"+"';
    }), true, 'session sheet brackets the superset with a + and marks the member on screen');
    await ss.getByRole('button', {name:'Move Row later'}).click();
    assert.equal(await ss.locator('#overview-dlg-body .superset-pair').count(), 0, 'moving a member out splits the superset');
    await ss.getByRole('button', {name:'Back to workout'}).click();
    await ss.evaluate(() => {
      const t = window.testAPI;
      t.state.activeWorkout = null; t.navigate('routines');
      t.ui.routineDraft = structuredClone(t.state.routines[0]); t.render();
    });
    assert.equal(await ss.locator('#routine-form .superset-pair').count(), 2, 'routine editor draws the superset bracket');
    await ss.getByRole('button', {name:'Superset…'}).click();
    const ssDialog = ss.getByRole('dialog', {name:'Superset'});
    await ssDialog.getByRole('button', {name:'Split'}).click();
    assert.equal(await ss.locator('#routine-form .superset-pair').count(), 0, 'split removes both superset markers');
    await ss.getByRole('button', {name:'Superset…'}).click();
    await ssDialog.getByLabel('First exercise').selectOption({label:'Bench · #1'});
    await ssDialog.getByLabel('Alternate with').selectOption({label:'Plank · #3'});
    await ssDialog.getByRole('button', {name:'Create superset'}).click();
    assert.deepEqual(await ss.locator('#routine-form .item-name').allTextContents().then(n => n.map(x => x.replace(/ in a superset with .*/, ''))),
      ['Bench', 'Plank', 'Row'], 'creating a superset from the dialog places the members together');
    assert.equal(await ss.evaluate(() => document.activeElement && document.activeElement.id), 'routine-superset-open',
      'focus returns to the superset button');
    await ss.screenshot({path:'/tmp/liftlog-superset-editor.png'});
    assert.equal(await ss.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'superset editor fits phone width');
    await ss.close();
    console.log('PASS supersets: ' + supersetUnits.length + ' state checks and the editor, workout and sheet flows');

    /* The session sheet: every exercise is one kind of row and reorders,
       finished ones included; "Now" follows the exercise; finishing one moves to
       the next with work left; and a superset can be made mid-session. */
    const so = await browser.newPage({ viewport:{ width:390, height:844 } });
    so.on('pageerror', e => errors.push(e.message));
    await so.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await so.goto('https://liftlog.test/');
    const sheetUnits = await so.evaluate(() => {
      const t = window.testAPI, checks = [];
      const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
      t.state.workouts = []; t.state.activeWorkout = null; t.state.settings.autoRest = false;
      t.state.exercises = ['A','B','C','D'].map(n => ({id:'so-' + n, name:n, category:'Push', unit:'kg', notes:'', archived:false}));
      t.state.routines = [{id:'rt-so', name:'Four', items:['A','B','C','D'].map(n =>
        ({id:'so-i' + n, exerciseId:'so-' + n, sets:n === 'D' ? 1 : 2, repsMin:8, repsMax:8, weight:20}))}];
      t.startRoutine('rt-so');
      const w = t.state.activeWorkout;
      const names = () => w.exercises.map(ex => ex.name).join('');
      const finish = () => t.currentExercise().sets.filter(s => !s.completed).forEach(s => t.toggleSet(s.id));
      finish();
      check(t.currentExercise().name === 'B' && t.isSettledRow(w, w.exercises[0], 0), 'finishing A moves on to B');
      t.moveSessionExercise(w, 0, 3);
      check(names() === 'BCDA' && t.currentExercise().name === 'B', 'a finished exercise moves, and Now stays put');
      t.moveSessionExercise(w, 0, 1);
      check(names() === 'CBDA' && t.currentExercise().name === 'C', 'moving the current exercise past open work hands Now over');
      t.moveSessionExercise(w, 2, 0);
      check(names() === 'DCBA' && t.currentExercise().name === 'C', 'moving another exercise leaves Now with the current one');
      t.moveSessionExercise(w, 3, 2);
      t.moveSessionExercise(w, 1, 2);
      check(names() === 'DACB' && t.currentExercise().name === 'C', 'moved past only finished work, the current exercise keeps Now');
      t.reopenExercise(0);
      t.moveSessionExercise(w, 0, 3);
      check(names() === 'ACBD' && t.currentExercise().name === 'C', 'Now goes to the first exercise with work left it was moved past');
      t.reopenExercise(3);
      check(!t.isSettledRow(w, w.exercises[1], 1), 'an exercise passed over by jumping ahead is not settled');
      finish();
      check(t.currentExercise().name === 'C', 'finishing the last exercise wraps back to work passed over earlier');
      t.moveSessionExercise(w, 0, 1);
      finish();
      check(names() === 'CABD' && t.currentExercise().name === 'B', 'finishing steps over finished work to the next exercise with sets left');
      check(!t.pairSessionExercises(1, 2), 'a finished exercise cannot join a superset');
      finish();
      check(t.currentExercise() === null && t.nextOpenBlock(w) === -1, 'with nothing left the session is complete');
      t.state.activeWorkout = null;
      t.startRoutine('rt-so');
      const w2 = t.state.activeWorkout;
      t.reopenExercise(1);
      check(t.pairSessionExercises(3, 1), 'two open exercises pair into a superset');
      check(w2.exercises.map(ex => ex.name).join('') === 'ACDB' && w2.exercises[2].supersetOf &&
        w2.exercises[2].supersetOf === w2.exercises[3].supersetOf, 'the second member moves to just after the first');
      check(t.currentExercise().name === 'B' && w2.currentExerciseIndex === 2 && w2.supersetSide === 1,
        'the exercise on screen stays on screen as a superset member');
      check(!t.state.routines[0].items.some(it => it.supersetOf), 'a session superset leaves the routine alone');
      check(!t.pairSessionExercises(0, 2), 'a superset member cannot pair again');
      t.toggleSet(t.currentExercise().sets[0].id);
      check(t.currentExercise().name === 'D', 'the new superset alternates');
      check(t.unpairSessionExercises(w2.exercises[2].supersetOf) && !w2.exercises.some(ex => ex.supersetOf) &&
        t.currentExercise().name === 'D' && w2.currentExerciseIndex === 2, 'splitting keeps the exercise on screen');
      t.state.activeWorkout = null;
      t.startRoutine('rt-so');
      finish();
      t.render();
      return checks;
    });
    await so.locator('#overview-toggle-btn').click();
    assert.equal(await so.evaluate(() => {
      const rows = [...document.querySelectorAll('#overview-dlg-body .overview-row')];
      return rows.length === 4 && rows.every(r => r.querySelector('.grip')) && rows[0].classList.contains('is-settled');
    }), true, 'every exercise in the sheet is a row with a grip, finished ones included');
    assert.equal(await so.locator('#ov-jump-0').innerText(), 'Reopen', 'a finished row offers Reopen where others offer Start now');
    await so.getByRole('button', {name:'Move A later'}).click();
    assert.deepEqual(await so.locator('#overview-dlg-body .ov-title').allTextContents().then(n => n.map(x => x.trim().replace(/^(Now|Done)\s*/, ''))),
      ['B', 'A', 'C', 'D'], 'a finished exercise moves with its arrows');
    assert.equal(await so.evaluate(() => document.activeElement && document.activeElement.id), 'ov-down-1', 'focus stays on the arrow');
    await so.locator('#session-superset-open').click();
    const soDialog = so.getByRole('dialog', {name:'Superset'});
    await soDialog.getByLabel('First exercise').selectOption({label:'B · #1'});
    await soDialog.getByLabel('Alternate with').selectOption({label:'D · #4'});
    await soDialog.getByRole('button', {name:'Create superset'}).click();
    assert.equal(await so.locator('#overview-dlg-body .superset-pair').count(), 2, 'a superset made in the sheet is bracketed');
    assert.equal(await so.evaluate(() => document.getElementById('overview-dlg').open &&
      document.activeElement && document.activeElement.id), 'session-superset-open', 'the sheet stays open, focus back on Superset…');
    assert.equal(await so.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      [...document.querySelectorAll('#overview-dlg-body .overview-row')].every(r => r.scrollWidth <= r.clientWidth)), true,
      'the session sheet fits phone width');
    await so.locator('#overview-dlg').screenshot({path:'/tmp/liftlog-session-overview.png'});
    await so.close();
    console.log(sheetUnits.map(c => 'PASS ' + c).join('\n') + '\nPASS session sheet: rows, reordering finished work and mid-session supersets');

    /* Routine import matching: the planner decides without writing, only
       uncertain matches reach the review dialog, and cancel changes nothing. */
    const im = await browser.newPage({ viewport:{ width:390, height:844 } });
    im.on('pageerror', e => errors.push(e.message));
    await im.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await im.goto('https://liftlog.test/');
    const matchChecks = await im.evaluate(() => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const sim = (a, b) => t.exerciseNameSimilarity(t.exerciseNameKey(a), t.exerciseNameKey(b));
      check(sim('Pull-ups', 'Pullup') === 'strong' && sim('Back Squat', 'Barbell Back Squat') === 'strong' &&
        sim('DB Curls', 'Dumbbell Curl') === 'strong' && sim('RDL', 'Romanian Deadlift') === 'strong',
        'name keys fold punctuation, plurals, abbreviations and unstated equipment');
      check(sim('Barbell Row', 'Dumbbell Row') === 'weak' && sim('Bench Press', 'Incline Bench Press') === 'weak',
        'different equipment or an added qualifier is only a weak match');
      check(sim('Leg Press', 'Leg Extension') === null && sim('Machine', 'Cable') === null,
        'unrelated names and equipment-only names do not match');
      const ex = (id, name, unit, loadMode, equipmentKey = '', archived = false) =>
        ({ id, name, category:'Other', unit, loadMode, equipmentKey, movementFamily:'other', archived, notes:'', url:'' });
      t.state.workouts = []; t.state.activeWorkout = null; t.state.routines = [];
      t.state.exercises = [ex('lib-squat','Back Squat','kg','total'), ex('lib-press','Leg Press','kg','machine_stack','gym-a-press'),
        ex('lib-bench','Bench Press','kg','total'), ex('lib-plank','Plank','time','duration'),
        ex('lib-pullup','Pull-up','bw','bodyweight_added'), ex('lib-row-old','Cable Row','kg','total','',true),
        ex('lib-row','Cable Row','kg','total'), ex('lib-dbpress','DB Shoulder Press','kg','per_hand'),
        ex('lib-curl','Leg Curl','kg','total')];
      const file = { app:'liftlog', kind:'routines', exercises:[
          ex('f-squat','Back Squat','kg','total','olympic-bar'), ex('f-press','Leg Press','kg','machine_stack','gym-b-press'),
          ex('f-incline','Incline Bench Press','kg','total'), ex('f-plank','plank ','time','duration'),
          ex('f-pullups','Pull-ups','bw','bodyweight_added'), ex('f-curl','Hammer Curl','kg','total'),
          ex('lib-bench','Lat Pulldown','kg','total'), ex('f-row','Cable Row','kg','total'),
          ex('f-timed-bench','Bench Press','time','duration'), ex('f-dbpress','DB Shoulder Press','kg','total'),
          ex('f-legcurl','Leg Curl','kg','machine_stack','gym-a-leg-curl')],
        routines:[{ id:'rt-new', name:'Imported', items:['f-squat','f-press','f-incline','f-plank','f-pullups','f-curl','lib-bench','f-row','f-timed-bench','f-dbpress','f-legcurl']
          .map((exerciseId, i) => ({ id:'it-' + i, exerciseId, sets:3, repsMin:5, repsMax:8, weight:40 })) }] };
      const before = JSON.stringify(t.state);
      const plan = t.planRoutineImport(structuredClone(file));
      check(JSON.stringify(t.state) === before, 'planning writes nothing');
      const by = id => plan.matches.find(m => m.src.id === id);
      check(by('f-plank').status === 'exact' && by('f-plank').target === 'lib-plank', 'identical name and contract match without review');
      check(by('f-row').status === 'exact' && by('f-row').target === 'lib-row', 'a live same-name exercise wins over an archived one');
      check(by('f-squat').status === 'review' && by('f-squat').target === 'lib-squat',
        'same name, different equipment is reviewed with the existing exercise pre-selected');
      check(by('f-press').status === 'review' && by('f-press').target === null,
        'two different named implements (gym A and gym B stacks) pre-select create');
      check(by('f-legcurl').status === 'review' && by('f-legcurl').target === 'lib-curl',
        'a machine-stack copy of a less detailed Library entry pre-selects the existing exercise');
      check(by('f-incline').status === 'review' && by('f-incline').target === null, 'a weak name match is offered but not pre-selected');
      check(by('f-pullups').status === 'review' && by('f-pullups').target === 'lib-pullup', 'a strong name match is pre-selected');
      check(by('f-curl').status === 'new' && by('lib-bench').status === 'new', 'no candidate, and an id reused for another name, create');
      check(by('f-timed-bench').status === 'new', 'a candidate must have the same measurement kind');
      const count = t.state.exercises.length;
      t.applyRoutineImport(plan, null);
      const items = t.state.routines.find(r => r.id === 'rt-new').items, at = i => items[i];
      check(at(0).exerciseId === 'lib-squat' && at(0).weight === 40 && at(10).exerciseId === 'lib-curl' && at(10).weight === 40,
        'equipment and total/stack differences keep the planned load');
      check(at(9).exerciseId === 'lib-dbpress' && at(9).weight === null, 'a per-hand/total difference drops the planned load');
      check(t.sameLoadNumbers(ex('a','A','kg','total'), ex('b','B','kg','machine_stack','k')) &&
        !t.sameLoadNumbers(ex('a','A','kg','total'), ex('b','B','bw','bodyweight_added')), 'load numbers compare by what they mean');
      check(t.state.exercises.find(e => e.id === 'f-timed-bench').name === 'Bench Press (Duration)',
        'an import never creates a second exercise with a name already in the Library');
      check(at(4).exerciseId === 'lib-pullup' && at(4).weight === 40 && at(3).exerciseId === 'lib-plank', 'compatible matches keep the plan');
      check(at(1).exerciseId === 'f-press' && at(2).exerciseId === 'f-incline' && at(5).exerciseId === 'f-curl',
        'created exercises keep their free source ids');
      check(at(6).exerciseId !== 'lib-bench' && t.state.exercises.find(e => e.id === at(6).exerciseId).name === 'Lat Pulldown',
        'an id collision creates under a fresh id');
      check(t.state.exercises.length === count + 5, 'only unmatched exercises are created');
      t.state.routines = []; t.state.exercises.splice(count);
      const again = t.planRoutineImport(structuredClone(file));
      t.applyRoutineImport(again, new Map([[again.matches.find(m => m.src.id === 'f-incline').src, 'lib-bench'],
        [again.matches.find(m => m.src.id === 'f-squat').src, '']]));
      const chosen = t.state.routines[0].items;
      check(chosen[2].exerciseId === 'lib-bench' && chosen[0].exerciseId !== 'lib-squat', 'review choices override the defaults');
      t.state.routines = []; t.state.exercises.splice(count);
      t.state.exercises.push(ex('lib-row-2','Cable Row','kg','total'));
      const logged = (id, exerciseId, name, unit = 'kg') => ({ id, routineId:null, routineName:'Log', startedAt:1000, finishedAt:2000, notes:'',
        exercises:[{ exerciseId, name, unit, loadMode:'total', equipmentKey:'', sets:[{ id:id + '-s', weight:40, reps:8, completed:true, unit }] }] });
      t.state.workouts.push(logged('w-row-2', 'lib-row-2', 'Cable Row'));
      const twice = t.planRoutineImport(structuredClone(file));
      check(twice.matches.find(m => m.src.id === 'f-row').status === 'review' &&
        twice.matches.find(m => m.src.id === 'f-row').target === 'lib-row-2',
        'among several same-name exercises the one with history is pre-selected');
      t.state.exercises.pop(); t.state.workouts = [];

      /* Merging across load conventions is safe exactly when nothing is logged under the copy. */
      t.state.workouts.push(logged('w-curl', 'lib-curl', 'Leg Curl'));
      t.state.exercises.push(ex('dup-curl','Leg Curl','kg','machine_stack','gym-a-leg-curl'), ex('dup-dbpress','DB Shoulder Press','kg','total'),
        ex('dup-logged','Leg Curl Old','kg','machine_stack','gym-b'));
      t.state.workouts.push(logged('w-dup', 'dup-logged', 'Leg Curl Old'));
      t.state.routines = [{ id:'rt-merge', name:'Merge', items:[
        { id:'m1', exerciseId:'dup-curl', sets:3, repsMin:8, repsMax:10, weight:50 },
        { id:'m2', exerciseId:'dup-dbpress', sets:3, repsMin:8, repsMax:10, weight:30 }] }];
      t.navigate('exercises'); t.ui.mergeExerciseId = 'dup-curl'; t.render();
      check([...document.querySelectorAll('#ex-merge-form option')].some(o => o.value === 'lib-curl'),
        'the merge picker offers an exercise recorded differently for a copy with no history');
      t.ui.mergeExerciseId = null;
      check(t.mergeExercises('dup-curl', 'lib-curl') === '' && !t.state.exercises.some(e => e.id === 'dup-curl') &&
        t.state.routines[0].items[0].exerciseId === 'lib-curl' && t.state.routines[0].items[0].weight === 50 &&
        !t.state.exerciseLinks.some(l => l.sourceId === 'dup-curl'),
        'a copy with no history merges across load conventions, keeping a planned load that means the same');
      check(t.mergeExercises('dup-dbpress', 'lib-dbpress') === '' && t.state.routines[0].items[1].weight === null,
        'merging into a per-hand exercise drops a total-load plan');
      check(t.mergeExercises('dup-logged', 'lib-curl') !== '' && t.state.exercises.some(e => e.id === 'dup-logged'),
        'a copy with its own history still needs the same contract');
      t.state.exercises = t.state.exercises.filter(e => e.id !== 'dup-logged'); t.state.routines = []; t.state.workouts = [];

      /* Names stay distinguishable wherever an exercise is created or renamed. */
      t.ui.exerciseDraft = { ...structuredClone(t.state.exercises.find(e => e.id === 'lib-bench')), name:'back  SQUAT' };
      t.saveExerciseDraft();
      check(t.state.exercises.find(e => e.id === 'lib-bench').name === 'Bench Press' && t.ui.exerciseDraft,
        'renaming to another exercise’s name is refused and the edit stays open');
      t.ui.exerciseDraft = { ...structuredClone(t.state.exercises.find(e => e.id === 'lib-bench')), name:'BENCH PRESS' };
      t.saveExerciseDraft();
      check(t.state.exercises.find(e => e.id === 'lib-bench').name === 'BENCH PRESS' && !t.ui.exerciseDraft, 'changing only case is a rename of itself');
      t.state.exercises.find(e => e.id === 'lib-bench').name = 'Bench Press';
      t.state.workouts.push(logged('w-hist', 'hist-squat', 'Back Squat'));
      check(t.addHistoricalExerciseToLibrary('hist-squat') && t.state.exercises.find(e => e.id === 'hist-squat').name === 'Back Squat (Total load)',
        'creating a Library exercise from history keeps names distinct');
      t.state.exercises = t.state.exercises.filter(e => e.id !== 'hist-squat'); t.state.workouts = [];
      check(t.distinctExerciseName('Leg Press', ex('x','Leg Press','kg','machine_stack','gym-b-press')) === 'Leg Press (gym-b-press)',
        'a distinct name names the equipment when there is one');
      t.state.exercises.push(ex('lib-bb-curl','Barbell Curl','kg','total'), ex('lib-db-curl','Dumbbell Curl','kg','total'));
      const curl = t.planRoutineImport({ exercises:[ex('f-curl-plain','Curls','kg','total')],
        routines:[{ name:'Arms', items:[{ exerciseId:'f-curl-plain' }] }] }).matches[0];
      check(curl.status === 'review' && curl.target === null && curl.candidates.filter(c => c.tier === 'strong').length === 2,
        'two equally strong candidates are offered, neither pre-selected');
      t.state.exercises.splice(-2);
      window.__matchFile = file;
      return checks;
    });
    const importFile = () => im.evaluate(() => window.testAPI.importRoutines(
      new File([JSON.stringify(window.__matchFile)], 'routines.json', {type:'application/json'})));
    const matchDialog = im.getByRole('dialog', {name:'Match imported exercises'});
    await importFile();
    await matchDialog.waitFor();
    assert.equal(await matchDialog.locator('.history-link-row').count(), 6, 'only uncertain matches are listed for review');
    assert.equal(await matchDialog.locator('.history-link-row', {hasText:'Leg Press'}).getByRole('option', {name:/Create as a new exercise \(“Leg Press \(gym-b-press\)”\)/}).count(), 1,
      'creating beside a same-name exercise says which name it will get');
    assert.match(await im.locator('#import-match-auto').innerText(), /2 other exercises matched exactly · 3 exercises with no match will be created/,
      'the review counts what was decided without asking');
    assert.equal(await im.evaluate(() => document.activeElement && document.activeElement.id), 'import-match-0', 'focus starts on the first choice');
    assert.equal(await im.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the review fits phone width');
    await im.screenshot({path:'/tmp/liftlog-import-match.png'});
    const beforeCancel = await im.evaluate(() => JSON.stringify(window.testAPI.state));
    await matchDialog.getByRole('button', {name:'Cancel import'}).click();
    assert.equal(await im.evaluate(() => JSON.stringify(window.testAPI.state)), beforeCancel, 'cancelling the review changes nothing');
    await importFile();
    await matchDialog.waitFor();
    await im.keyboard.press('Escape');
    assert.equal(await im.evaluate(() => window.testAPI.state.routines.length), 0, 'Esc cancels the import too');
    await importFile();
    await matchDialog.waitFor();
    assert.equal(await matchDialog.locator('.history-link-row', {hasText:'Back Squat'}).getByText('planned load is left out').isVisible(), false,
      'an equipment-only difference keeps the planned load, and says nothing');
    const importPressRow = matchDialog.locator('.history-link-row', {hasText:'DB Shoulder Press'});
    assert.equal(await importPressRow.getByText('planned load is left out').isVisible(), true,
      'a pre-selected per-hand match says its planned load is dropped');
    await importPressRow.locator('select').selectOption('');
    assert.equal(await importPressRow.getByText('planned load is left out').isVisible(), false, 'the note follows the choice');
    await importPressRow.locator('select').selectOption('lib-dbpress');
    await matchDialog.locator('.history-link-row', {hasText:'Incline Bench Press'}).locator('select').selectOption('lib-bench');
    await matchDialog.getByRole('button', {name:'Import routines'}).click();
    await im.waitForFunction(() => window.testAPI.state.routines.length === 1);
    assert.deepEqual(await im.evaluate(() => window.testAPI.state.routines[0].items.slice(0, 5).map(it => it.exerciseId)),
      ['lib-squat', 'f-press', 'lib-bench', 'lib-plank', 'lib-pullup'], 'confirmed choices are applied');
    await im.evaluate(() => { const t = window.testAPI; t.state.exercises = []; t.state.routines = [];
      t.importRoutines(new File([JSON.stringify(t.sampleRoutinesFile())], 's.json', {type:'application/json'})); });
    await im.waitForFunction(() => window.testAPI.state.routines.length === 2);
    assert.equal(await im.locator('#import-match-dlg').evaluate(d => d.open), false, 'a clean import asks nothing');
    await im.close();
    console.log(matchChecks.map(s => 'PASS ' + s).join('\n') + '\nPASS routine import review: cancel, Esc, choose, confirm, clean import');

    /* Editing a linked exercise's load convention: the next load would drop
       links whose history no longer fits, so the editor asks first. */
    const lg = await browser.newPage({ viewport:{ width:390, height:844 } });
    lg.on('pageerror', e => errors.push(e.message));
    await lg.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await lg.goto('https://liftlog.test/');
    const guardChecks = await lg.evaluate(async () => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const wait = () => new Promise(r => setTimeout(r, 30));
      const press = label => [...document.querySelectorAll('#dlg-actions button')].find(b => b.textContent === label).click();
      const block = (exerciseId, loadMode = 'total', equipmentKey = '') => ({ exerciseId, name:'Leg Curl', unit:'kg', loadMode, equipmentKey,
        sets:[{ id:exerciseId + '-s', weight:40, reps:10, completed:true, unit:'kg' }] });
      const reset = () => {
        t.state.activeWorkout = null; t.state.routines = [];
        t.state.exercises = [{ id:'lc', name:'Leg Curl', category:'Legs', unit:'kg', loadMode:'total', equipmentKey:'',
          movementFamily:'hinge', archived:false, notes:'', url:'' }];
        t.state.workouts = [['w1','lc'], ['w2','old-lc'], ['w3','old-bad','machine_stack','gym-x']].map(([id, ...b], n) =>
          ({ id, routineId:null, routineName:'Log', startedAt:1000 + n, finishedAt:2000 + n, notes:'', exercises:[block(...b)] }));
        t.state.exerciseLinks = [{ sourceId:'old-lc', targetId:'lc' }, { sourceId:'old-bad', targetId:'lc' }];
        t.state.historySeparateIds = [];
      };
      const draft = changes => { t.ui.exerciseDraft = { ...structuredClone(t.state.exercises[0]), ...changes }; };
      const stack = { loadMode:'machine_stack', equipmentKey:'gym-a-leg-curl' };
      reset();
      const lc = t.state.exercises[0];
      check(t.linksBrokenBy('lc', { ...lc, ...stack }).map(l => l.sourceId).join() === 'old-lc',
        'the edit predicts exactly the links it would break, not one already failing');
      check(t.linksBrokenBy('lc', { ...lc, notes:'cue' }).length === 0, 'an edit outside the contract breaks nothing');
      draft({ notes:'cue' }); t.saveExerciseDraft();
      check(!document.querySelector('#dlg').open && t.state.exercises[0].notes === 'cue' && !t.ui.exerciseDraft,
        'an edit that breaks no link saves without asking');
      draft(stack); let pending = t.saveExerciseDraft(); await wait();
      check(document.querySelector('#dlg').open && /1 earlier exercise \(1 session\) recorded as Total load, no equipment key/.test(document.querySelector('#dlg-body').textContent),
        'a breaking edit asks first, naming what would separate');
      press('Cancel'); await pending;
      check(t.state.exercises[0].loadMode === 'total' && t.ui.exerciseDraft && t.state.exerciseLinks.length === 2,
        'cancel changes nothing and keeps the editor open');
      draft({ ...stack, notes:'kept' }); pending = t.saveExerciseDraft(); await wait();
      press('Keep history together'); await pending;
      const kept = t.state.exercises[0];
      check(kept.loadMode === 'total' && kept.equipmentKey === '' && kept.notes === 'kept' && !t.ui.exerciseDraft,
        'keeping history together saves the other fields and the old convention');
      check(t.prepareBackup(t.backupPayload()).exerciseLinks.some(l => l.sourceId === 'old-lc'),
        'the kept link survives the next load');
      draft(stack); pending = t.saveExerciseDraft(); await wait();
      press('Change anyway'); await pending;
      check(t.state.exercises[0].loadMode === 'machine_stack' && !t.state.exerciseLinks.some(l => l.sourceId === 'old-lc') &&
        t.state.exerciseLinks.some(l => l.sourceId === 'old-bad'),
        'changing anyway saves the new convention and removes exactly the broken links now');
      check(t.unresolvedHistoryExercises().some(x => x.id === 'old-lc'), 'the separated history is offered for review');
      reset(); t.navigate('exercises'); draft({}); t.render();
      return checks;
    });
    await lg.locator('#ex-edit-form select[data-field="loadMode"]').selectOption('machine_stack');
    await lg.locator('#ex-edit-form input[data-field="equipmentKey"]').fill('gym-a-leg-curl');
    await lg.locator('#ex-edit-form').getByRole('button', {name:'Save'}).click();
    const splitDialog = lg.getByRole('dialog', {name:'Keep this exercise’s history together?'});
    await splitDialog.waitFor();
    assert.equal(await lg.evaluate(() => document.activeElement && document.activeElement.textContent), 'Keep history together',
      'keeping history together is the focused choice');
    await splitDialog.getByRole('button', {name:'Keep history together'}).click();
    await lg.waitForFunction(() => !window.testAPI.ui.exerciseDraft);
    assert.deepEqual(await lg.evaluate(() => [window.testAPI.state.exercises[0].loadMode, window.testAPI.state.exerciseLinks.length]),
      ['total', 2], 'the editor keeps the convention and the links when asked to');
    await lg.close();
    console.log(guardChecks.map(s => 'PASS ' + s).join('\n') + '\nPASS the exercise editor asks before splitting history');

    /* One-off plans: routines with plan/plannedFor that are spent once their
       session is saved. */
    const pl = await browser.newPage({ viewport:{ width:390, height:844 } });
    pl.on('pageerror', e => errors.push(e.message));
    await pl.route('https://liftlog.test/**', route => route.fulfill({ contentType:'text/html', body:html }));
    await pl.goto('https://liftlog.test/');
    const planChecks = await pl.evaluate(async () => {
      const t = window.testAPI, checks = [];
      const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
      const wait = () => new Promise(r => setTimeout(r, 30));
      const press = label => [...document.querySelectorAll('#dlg-actions button')].find(b => b.textContent === label).click();
      const day = offset => t.localDay(Date.now() + offset * 86400000);
      const item = id => ({ id, exerciseId:'bench', sets:1, repsMin:5, repsMax:5, targetRir:null, weight:60 });
      const setup = () => {
        t.state.activeWorkout = null; t.state.workouts = [];
        t.state.exercises = [{ id:'bench', name:'Bench Press', category:'Push', unit:'kg', loadMode:'total', equipmentKey:'',
          movementFamily:'horizontal_push', archived:false, notes:'', url:'' }];
        t.state.routines = [
          { id:'rt-b', name:'Day B', items:[item('b1')] },
          { id:'pl-later', name:'Next week', plan:true, plannedFor:day(7), items:[item('l1')] },
          { id:'pl-any', name:'Whenever', plan:true, plannedFor:null, items:[item('a1')] },
          { id:'pl-today', name:'Push today', plan:true, plannedFor:day(0), items:[item('t1')] },
          { id:'pl-late', name:'Day B', plan:true, plannedFor:day(-1), items:[item('o1')] }];
      };
      setup();
      const order = t.sortedPlans();
      check(order.map(x => x.r.id).join() === 'pl-late,pl-today,pl-any,pl-later', 'plans order overdue, today, anytime, later');
      check(/^Overdue · /.test(order[0].day.label) && order[0].day.overdue && order[1].day.label === 'Today' &&
        order[2].day.label === 'Anytime' && !order[3].day.overdue, 'each plan is labelled by its day');
      check(t.defaultRoutineId() === 'pl-late', 'Today highlights the most pressing plan first');
      const complete = () => { t.state.activeWorkout.exercises[0].sets[0].completed = true; };
      t.startRoutine('pl-today'); complete(); t.finishWorkout();
      check(!t.state.routines.some(r => r.id === 'pl-today') && t.state.workouts.some(w => w.routineName === 'Push today' && w.routineId === 'pl-today') &&
        t.state.workouts[0].exercises[0].targetRepsMin === 5, 'saving a plan’s session removes the plan and History keeps what it prescribed');
      t.startRoutine('pl-any'); let pending = t.finishWorkout(); await wait();
      press('Discard'); await wait();
      check(t.state.routines.some(r => r.id === 'pl-any') && !t.state.activeWorkout, 'discarding a plan’s session keeps the plan');
      t.startRoutine('rt-b'); complete(); t.finishWorkout();
      check(t.state.routines.some(r => r.id === 'rt-b'), 'a stable routine is never used up');
      t.ui.routineDraft = { ...structuredClone(t.state.routines.find(r => r.id === 'rt-b')), plan:true, plannedFor:'2030-02-30' };
      t.saveRoutineDraft();
      check(t.ui.routineDraft && t.ui.routineError && !t.state.routines.find(r => r.id === 'rt-b').plan, 'an impossible plan day is refused');
      t.ui.routineDraft.plannedFor = '2030-03-04'; t.saveRoutineDraft();
      const converted = t.state.routines.find(r => r.id === 'rt-b');
      check(converted.plan === true && converted.plannedFor === '2030-03-04', 'the editor turns a routine into a plan');
      t.ui.routineDraft = { ...structuredClone(converted), plan:false }; t.saveRoutineDraft();
      const back = t.state.routines.find(r => r.id === 'rt-b');
      check(!('plan' in back) && !('plannedFor' in back), 'and back into a stable routine with no plan fields left');
      const draft = t.newPlanDraft(back);
      check(draft.id === null && draft.plan === true && draft.plannedFor === t.localDay() && draft.items[0].id !== 'b1' &&
        back.items[0].id === 'b1' && !back.plan, 'Plan… copies a routine as today’s plan and leaves the routine alone');
      setup();
      const file = t.routinesPayload(t.state.exercises, [
        { id:'f1', name:'Day B', plan:true, plannedFor:day(-1), items:[item('x1')] },
        { id:'f2', name:'Day B', plan:true, plannedFor:day(14), items:[item('x2')] },
        { id:'f3', name:'Day B', items:[item('x3')] },
        { id:'f4', name:'Loose', plan:true, plannedFor:'not a day', items:[item('x4')] }]);
      t.importRoutines(new File([JSON.stringify(file)], 'p.json', {type:'application/json'})); await wait(); await wait();
      check(!t.state.routines.some(r => r.id === 'f1') && t.state.routines.some(r => r.id === 'f2' && r.plannedFor === day(14)) &&
        !t.state.routines.some(r => r.id === 'f3'), 'import dedupes a plan by name and day, and a routine by name');
      check(t.state.routines.find(r => r.id === 'f4').plannedFor === null, 'an imported plan with an invalid day becomes anytime');
      const round = t.prepareBackup(t.backupPayload());
      check(round.routines.find(r => r.id === 'f2').plan === true && round.routines.find(r => r.id === 'f2').plannedFor === day(14) &&
        !('plan' in round.routines.find(r => r.id === 'rt-b')), 'a backup keeps plans and stable routines apart');
      const v13 = t.backupPayload(); v13.version = 13; v13.routines.forEach(r => { delete r.plan; delete r.plannedFor; });
      check(t.prepareBackup(v13).version === 14 && t.prepareBackup(v13).routines.every(r => !r.plan), 'v13 data migrates, every routine stable');
      setup(); t.navigate('today');
      return checks;
    });
    await pl.waitForTimeout(3000); // let the setup's toasts leave before the screenshots
    const planned = pl.getByRole('group', {name:'Choose a plan'});
    assert.equal(await planned.locator('.routine-pick-row').count(), 4, 'Today lists every plan');
    assert.equal(await planned.locator('.routine-pick-row').first().getByText('Overdue', {exact:true}).isVisible(), true, 'an overdue plan is marked');
    assert.equal(await pl.getByRole('group', {name:'Choose a routine'}).locator('.routine-pick-row').count(), 1, 'the routine list holds stable routines only');
    assert.equal(await pl.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Today with plans fits phone width');
    await pl.screenshot({path:'/tmp/liftlog-plans-today.png', fullPage:true});
    await pl.evaluate(() => window.testAPI.navigate('routines'));
    assert.equal(await pl.getByRole('list', {name:'Planned sessions'}).locator('li').count(), 4, 'Routines lists plans in their own section');
    await pl.screenshot({path:'/tmp/liftlog-plans-routines.png', fullPage:true});
    await pl.getByRole('list', {name:'Routines'}).getByRole('button', {name:'Day B'}).click();
    await pl.getByRole('button', {name:'Plan a session from Day B'}).click();
    await pl.locator('#routine-planned-for').fill('2031-05-06');
    await pl.locator('#routine-form').getByRole('button', {name:'Save'}).click();
    assert.equal(await pl.evaluate(() => window.testAPI.state.routines.filter(r => r.name === 'Day B' && r.plannedFor === '2031-05-06').length), 1,
      'Plan… in a routine’s sheet saves a dated copy');
    await pl.close();
    console.log(planChecks.map(s => 'PASS ' + s).join('\n') + '\nPASS plans on Today and Routines, and Plan… from a routine sheet');

    /* Detail sheets: a routine, an exercise and a logged session all open in
       the same read-only sheet, and Edit hands over to the editor in the page. */
    const ds = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
    ds.on('pageerror', e => errors.push(e.message));
    await ds.route('https://liftlog.test/**', route => route.fulfill({contentType:'text/html',body:html}));
    await ds.goto('https://liftlog.test/');
    const sheetChecks = [];
    const sheetCheck = (ok, label) => { assert.equal(ok, true, label); sheetChecks.push(label); };
    const sheetState = () => ds.evaluate(() => ({
      open: document.querySelector('#detail-dlg').open,
      focus: document.activeElement && document.activeElement.id,
      locked: document.documentElement.classList.contains('sheet-open')
    }));
    const fitsWidth = () => ds.evaluate(() => {
      const d = document.querySelector('#detail-dlg');
      return document.documentElement.scrollWidth <= innerWidth && d.scrollWidth <= d.clientWidth;
    });
    await ds.evaluate(() => {
      const t = window.testAPI;
      t.state.exercises = [
        {id:'ds-bench',name:'Bench Press',category:'Push',movementFamily:'horizontal_push',unit:'kg',loadMode:'total',equipmentKey:'',notes:'Pause on the chest',url:'https://example.com/bench',archived:false},
        {id:'ds-dip',name:'Dip',category:'Push',movementFamily:'vertical_push',unit:'bw',loadMode:'bodyweight_added',equipmentKey:'',notes:'',url:'',archived:false},
        {id:'ds-row',name:'Cable Row',category:'Pull',movementFamily:'horizontal_pull',unit:'kg',loadMode:'machine_stack',equipmentKey:'',notes:'',url:'',archived:false},
        {id:'ds-plank',name:'Plank',category:'Core',movementFamily:'core',unit:'time',loadMode:'duration',equipmentKey:'',notes:'',url:'',archived:false}
      ];
      t.state.routines = [{id:'ds-push',name:'Push day',items:[
        {id:'ds-i1',exerciseId:'ds-bench',sets:3,repsMin:5,repsMax:8,targetRir:2,weight:80},
        {id:'ds-i2',exerciseId:'ds-dip',sets:3,repsMin:8,repsMax:12,targetRir:null,weight:10,supersetOf:'ds-ss'},
        {id:'ds-i3',exerciseId:'ds-row',sets:3,repsMin:10,repsMax:12,targetRir:null,weight:null,supersetOf:'ds-ss'},
        {id:'ds-i4',exerciseId:'ds-plank',sets:2,repsMin:45,repsMax:45,targetRir:null,weight:null}
      ]}];
      t.state.workouts = [{id:'ds-w1',routineId:'ds-push',routineName:'Push day',startedAt:Date.now()-86400000,
        finishedAt:Date.now()-86400000+2700000,notes:'Felt strong',exercises:[
          {exerciseId:'ds-bench',name:'Bench Press',category:'Push',unit:'kg',loadMode:'total',targetRepsMin:5,targetRepsMax:8,
            sets:[{id:'ds-s1',weight:80,reps:8,unit:'kg',completed:true},{id:'ds-s2',weight:80,reps:7,unit:'kg',completed:true}]}]}];
      t.state.activeWorkout = null;
      t.navigate('routines');
    });

    await ds.locator('[data-kind="routine"]').click();
    const pushSheet = ds.getByRole('dialog', {name:'Push day'});
    const opened = await sheetState();
    sheetCheck(opened.open && opened.focus === 'detail-title' && opened.locked,
      'tapping a routine opens its sheet, focused on the title, with the page locked behind it');
    sheetCheck(await pushSheet.locator('input, select, textarea').count() === 0,
      'the routine sheet is read-only');
    sheetCheck(JSON.stringify(await pushSheet.locator('.detail-item-name').evaluateAll(n => n.map(x => x.firstChild.textContent))) ===
      JSON.stringify(['Bench Press','Dip','Cable Row','Plank']), 'the routine sheet lists every exercise in order');
    sheetCheck(JSON.stringify(await pushSheet.locator('.detail-item-target').allTextContents()) ===
      JSON.stringify(['3 × 5–8 reps @ 80 kg · RIR 2','3 × 8–12 reps @ +10 kg','3 × 10–12 reps','2 × 45 s']),
      'targets read sets × range, load and RIR, with seconds for timed work');
    sheetCheck(await pushSheet.locator('.superset-pair').count() === 2, 'a superset keeps the editor bracket in the sheet');
    sheetCheck((await pushSheet.locator('.detail-item-last').first().innerText()).includes('80 kg × 8'),
      'the sheet shows what was lifted last time');
    sheetCheck(await fitsWidth(), 'the routine sheet fits phone width');
    await ds.screenshot({path:'/tmp/liftlog-routine-sheet.png'});
    await ds.keyboard.press('Escape');
    /* a dialog's close event is queued, so this waits for it to land */
    sheetCheck(await ds.waitForFunction(() => !document.querySelector('#detail-dlg').open &&
        document.activeElement.id === 'open-routine-ds-push' && !document.documentElement.classList.contains('sheet-open'),
        null, {timeout:2000}).then(() => true, () => false),
      'Escape closes the sheet and returns focus to the row');

    const rowBox = await ds.locator('.list-row.is-openable').boundingBox();
    await ds.mouse.click(rowBox.x + rowBox.width - 8, rowBox.y + rowBox.height - 8);
    sheetCheck((await sheetState()).open, 'the whole row opens the sheet, not only its text');
    await pushSheet.getByRole('button', {name:'Close routine'}).click();
    await ds.locator('[data-kind="routine"]').click();
    await pushSheet.getByRole('button', {name:'Duplicate Push day'}).click();
    sheetCheck(await ds.locator('#detail-title').innerText() === 'Push day (copy)' && (await sheetState()).focus === 'detail-dup',
      'duplicating from the sheet shows the copy, keeping focus on the button');
    await ds.getByRole('dialog', {name:'Push day (copy)'}).getByRole('button', {name:'Edit Push day (copy)'}).click();
    sheetCheck(!(await sheetState()).open && (await sheetState()).focus === 'routine-form' &&
      await ds.locator('[data-bind="rdraft"][data-field="name"]').inputValue() === 'Push day (copy)',
      'Edit closes the sheet and opens the routine editor in the page');
    await ds.getByRole('button', {name:'Cancel', exact:true}).click();

    await ds.getByRole('button', {name:'Exercises', exact:true}).click();
    await ds.locator('[data-kind="exercise"]').filter({hasText:'Bench Press'}).click();
    const benchSheet = ds.getByRole('dialog', {name:'Bench Press'});
    sheetCheck(await benchSheet.locator('input, select, textarea').count() === 0, 'the exercise sheet is read-only');
    sheetCheck((await benchSheet.locator('.detail-facts').first().innerText()).includes('horizontal push') &&
      await benchSheet.getByRole('link', {name:/How to perform Bench Press/}).count() === 1 &&
      (await benchSheet.innerText()).includes('Pause on the chest'),
      'the exercise sheet shows its definition, note and how-to link');
    sheetCheck((await benchSheet.innerText()).includes('Best e1RM') &&
      await benchSheet.locator('[aria-label="Recent sessions"] li').count() === 1 &&
      JSON.stringify(await benchSheet.locator('.detail-section').last().locator('li').allTextContents()) === JSON.stringify(['Push day','Push day (copy)']),
      'the exercise sheet shows bests, recent sessions and the routines using it');
    sheetCheck(await fitsWidth(), 'the exercise sheet fits phone width');
    await benchSheet.getByRole('button', {name:'Archive Bench Press'}).click();
    sheetCheck(await ds.evaluate(() => document.getElementById('toast-region').matches(':popover-open')) &&
      (await ds.locator('#toast-region').innerText()).includes('Exercise archived'),
      'a toast raised from a sheet is restacked above it');
    sheetCheck((await sheetState()).open && (await sheetState()).focus === 'detail-archive' &&
      await ds.locator('#detail-sub').innerText() === 'Push · archived',
      'archiving keeps the sheet open, marked archived, focus on the same control');
    await benchSheet.getByRole('button', {name:'Edit Bench Press'}).click();
    sheetCheck(!(await sheetState()).open && (await sheetState()).focus === 'ex-edit-form' &&
      await ds.locator('#ex-edit-form [data-field="name"]').inputValue() === 'Bench Press',
      'editing an archived exercise from its sheet reveals its row and opens the editor there');
    await ds.getByRole('button', {name:'Cancel', exact:true}).click();

    await ds.getByRole('button', {name:'History', exact:true}).click();
    await ds.locator('.hist-row').click();
    const sessionSheet = ds.getByRole('dialog', {name:'Push day'});
    sheetCheck((await sessionSheet.locator('.detail-stats').innerText()).includes('2 sets') &&
      (await sessionSheet.innerText()).includes('Felt strong') && await sessionSheet.locator('.hist-ex').count() === 1,
      'a logged session opens in the same sheet with its totals, note and exercises');
    await sessionSheet.getByRole('button', {name:'Edit session'}).click();
    sheetCheck(!(await sheetState()).open && (await sheetState()).focus === 'hedit' && await ds.locator('#hedit input').count() > 0,
      'Edit session closes the sheet and opens the editor under the row');
    await ds.getByRole('button', {name:'Done', exact:true}).click();

    await ds.evaluate(() => { window.testAPI.state.exercises.find(e => e.id === 'ds-bench').archived = false; window.testAPI.startRoutine('ds-push'); });
    await ds.evaluate(() => { window.testAPI.toggleSet(window.testAPI.state.activeWorkout.exercises[0].sets[0].id); window.testAPI.finishWorkout(); });
    const finished = await ds.evaluate(() => window.testAPI.state.workouts[0].id);
    sheetCheck(await ds.evaluate(id => window.testAPI.ui.view === 'history' && window.testAPI.ui.detail &&
      window.testAPI.ui.detail.id === id && document.querySelector('#detail-dlg').open, finished),
      'finishing a workout opens it in its sheet as the summary');
    await ds.screenshot({path:'/tmp/liftlog-session-sheet.png'});
    await ds.keyboard.press('Escape');

    /* a met target shows its load guidance in the routine sheet too */
    await ds.evaluate(() => {
      const t = window.testAPI, at = Date.now() + 60000;
      t.state.workouts.unshift({id:'ds-ready',routineId:'ds-push',routineName:'Push day',startedAt:at,finishedAt:at + 600000,notes:'',
        exercises:[{exerciseId:'ds-bench',name:'Bench Press',category:'Push',unit:'kg',loadMode:'total',plannedSets:3,targetRepsMin:5,targetRepsMax:8,targetRir:2,
          sets:[1,2,3].map(n => ({id:'ds-r' + n,weight:85,reps:8,rir:2,unit:'kg',completed:true}))}]});
      t.navigate('routines');
    });
    await ds.getByRole('button', {name:'Push day', exact:true}).click();
    const cueSheet = ds.getByRole('dialog', {name:'Push day'});
    sheetCheck(await cueSheet.locator('.detail-cues .cue-table tbody tr').count() === 1 &&
      (await cueSheet.locator('.detail-cues').innerText()).includes('Bench Press') &&
      /^87\.5 kg × 5$/.test(await cueSheet.locator('.cue-next').innerText()),
      'the routine sheet leads with the load table for a met target');
    sheetCheck(await ds.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the load table fits phone width');
    await cueSheet.getByRole('button', {name:'Actions for Bench Press'}).click();
    await cueSheet.getByRole('button', {name:'Dismiss this result'}).click();
    sheetCheck(await cueSheet.locator('.detail-cues').count() === 0 && (await sheetState()).open,
      'dismissing a cue from the sheet removes it and keeps the sheet open');
    await ds.close();
    console.log('PASS detail sheets: ' + sheetChecks.length + ' checks across routines, exercises and history');

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
    await touch.getByRole('button', {name:'Review progression series'}).click();
    assert.equal(await touch.locator('[data-change="history-link"][data-source="mobile-old-id"]').count(), 1,
      'duplicate-safe import can open exercise reconciliation');
    assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      'exercise reconciliation fits at 320px');
    assert.match(await touch.locator('#pair-dlg .desc').innerText(), /Completing either one removes the other/,
      'either-of dialog describes in-session completion behavior');
    await touch.close();
    assert.deepEqual(errors, []);
    console.log([...result, ...progressionChecks, ...remoteChecks, 'clear workout data preserves library, routines and settings',
      'mobile editor pairing and in-session alternative completion', 'History progression flag and navigation',
      'no browser errors'].map(s => 'PASS ' + s).join('\n'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

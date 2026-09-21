# Code audit — 2026-09-20

Scope: the single-file application, persistence and migrations, routine editing
and workout construction, transfer payloads and samples, service worker, and
architecture notes. This is a targeted code review and browser regression pass,
not an exhaustive security or cross-browser audit.

## Mobile UX/UI audit — 2026-09-21

Implementation status: findings 1, 3, 4, 6, and the planning fields from 7
were addressed on 2026-09-21. The notes below retain the measured before-state
and the rationale for the changes.

Tested the seeded application at 320×568 and 390×844 portrait, and 844×390
landscape, with the real UI in a touch-enabled Chromium context. Every main
view, the routine editor, either-of dialog, and active workout were inspected.
There was no page-level horizontal overflow or browser error at any tested
size. The either-of dialog fit the viewport, and the active workout kept its
top pager and bottom timer anchored at all three sizes.

### High priority

1. **Primary navigation is partly hidden on common phone widths.** The five
   text tabs overflow by 90px at 320px and 20px at 390px. At 320px, Settings is
   absent from the initial viewport; at 390px it sits under the permanent edge
   fade. Horizontal swiping works, but the only visible cue is the fade and the
   selected page can be off-screen. Keep all five destinations visible: use
   equal-width tabs with tighter horizontal padding and shorter labels (for
   example, Library instead of Exercises), or four primary tabs plus a visible
   overflow/settings control. A bottom bar would conflict with the workout
   timer and is therefore a poorer fit here.

   The label was subsequently restored to **Exercises**. The equal-width layout
   and tighter type still keep all five complete labels visible at 320px.

2. **Frequent and destructive row actions are below the app's own 44px touch
   standard.** Routine and exercise cards use 30–36px-high action buttons; the
   routine editor's move and remove controls are 30×30px. At 320px, duplicate
   and delete are approximately 41×30px and sit beside each other. Increase
   tap areas to 44×44px. On cards, keep Start/Edit visible and put duplicate and
   delete in one overflow menu; this reduces both clutter and accidental taps.

3. **Two user-facing descriptions contradict current behavior.** The either-of
   dialog says, “You will pick one when starting a workout,” although both now
   enter the workout and completing one removes the other. History's “Time
   under the bar” statistic is the sum of whole workout durations, not time
   under tension. Update the dialog explanation and rename the statistic to
   “Workout time · 30 days.”

4. **The History hierarchy delays the useful information at 320px.** Its four
   summary cards collapse to a single column because each requires 140px plus
   the grid gap. Progress is therefore more than four cards and a chart below
   the heading. Use an explicit two-column compact grid at narrow widths
   (`minmax(0,1fr)`), place progression flags before aggregate charts, and keep
   Workouts reachable without a long analytics preamble.

### Medium priority

5. **Settings is comprehensive but behaves like a reference page.** At 320px
   the seeded screen is about 3,150px tall. Backup, storage, remote storage,
   transfer, danger-zone, and keyboard material appear at once. When storage is
   non-persistent, Download backup appears twice in adjacent sections. Keep
   everyday settings open; collapse Remote storage, Transfer, Diagnostics, and
   Keyboard shortcuts under Advanced/Data sections. Merge the storage warning
   into Backup & restore so it has one status and one primary backup action.

6. **Desktop affordances consume mobile space.** Today shows “press S,” the
   footer advertises keyboard help, and Settings renders a full shortcut table
   on touch devices. Hide these under `pointer:coarse`, or move them to a single
   Help dialog. This reinforces the mobile-first product instead of merely
   making the desktop UI responsive.

7. **Double progression is detected but not fully represented in planning.**
   History now identifies rep/load stalls, but routine items store a single rep
   target rather than a range, and technique is not recorded. RIR is optional
   and off by default. Add lower/upper rep targets and an optional target RIR
   per routine item. Show the range in Today and offer a load-increase cue only
   when all prescribed sets reach the upper bound and logged RIR is within the
   target. Keep it advisory because technique still requires human judgment.

8. **Warm-up classification is too hidden for progression-sensitive data.** A
   user must tap the set number or long-press Done; the resting set row gives no
   visible indication that the number is interactive. Since warm-ups affect
   volume, records, and plateau flags, add a discoverable Set type action (for
   example, Working/Warm-up in a row menu) while retaining long-press as the
   shortcut.

9. **Phone landscape is usable but cramped around the logging task.** At
   844×390 the sticky pager and timer work, but tags and the previous-performance
   strip leave roughly one set row visible; the next row sits behind the timer
   until scrolling. In the existing short-height media query, also collapse the
   previous-performance strip and secondary tags into one disclosure.

10. **Charts need a non-visual value view.** Line charts have a useful summary,
    but weekly bars expose individual values mainly through SVG titles, which
    are weak on touch and inconsistent for assistive technology. Add a compact
    text summary or accessible data list for weekly values. Keep arrows and
    words alongside trend colors, as the current trend footer already does.

### Lower priority

- Make Exercise search sticky once the library grows, and add a muscle-group
  filter rather than relying on one free-text field.
- Consider a row-level action menu in History editing as well; it currently
  exposes several compact controls per set.
- Preserve the quiet visual system. The restrained borders, limited semantic
  colors, tabular numbers, and clear empty states are well suited to a gym app.
  The active logging screen is the strongest part of the product and should
  remain the density benchmark for the rest of the application.

### Recommended order

Fix the stale labels and navigation first, then touch targets and the 320px
History grid. Next simplify Settings and improve warm-up discoverability.
Rep ranges/RIR targets are the larger product change; add them after the core
mobile interaction fixes so progression advice rests on data the app can
actually capture.

## Remaining findings

1. **Medium: the history contract accepts measurements the editor cannot fully manage.**
   `normalizeImportedSet` supports distance, but the ordinary logging/editor
   controls do not provide equivalent distance editing. Negative distance values
   are retained even though other negative measurements are dropped. Also,
   explicit `setType: "reps"` with `unit: "time"` is interpreted as time despite
   the documented claim that setType takes precedence. Decide on supported
   measurements, enforce consistent precedence, and add mixed-field fixtures.
   Related distance support debt already appears in `ENHANCEMENTS.md`.

2. **Low: schema guarantees are implemented procedurally and tests need setup.**
   There is no standalone JSON Schema. Sample builders share export code, which
   ensures export shape but does not itself prove importer compatibility. The
   new browser regression script checks that compatibility; it requires Node,
   Playwright, and a Chromium browser. There is no automated test workflow in
   this repository. Keep the app dependency-free while adding a documented CI
   test environment if ongoing maintenance warrants it.

## History progression audit — 2026-09-21

- **Fit for double progression:** finished workouts retain each set's load,
  reps, completion, and optional RIR; warm-ups can be excluded. History editing
  and import allow corrections. That is enough to detect repeatable rep/load
  stalls without changing the file schema.
- **Current limits:** the per-exercise chart shows the best set's estimated 1RM,
  while the weekly charts show volume or set counts. Neither shows whether reps
  rose across *all* prescribed sets at one load. Routines have one rep target,
  not a rep range; there is no technique marker; effort logging defaults off.
  Added load on bodyweight movements is not recorded, so those flags use reps
  alone. The app cannot certify when a load increase is appropriate under the
  stated 1–2 RIR and technique rule. The existing green upward `+0` trend cue was
  misleading and is now neutral.
- **Flag added:** History shows an amber progression check after a baseline and
  three consecutive comparable exposures without more total reps at the same
  working load or a higher load. It excludes warm-ups and timed exercises,
  converts kg/lb, treats lower-load work as a new window, and restarts after
  incomplete or mixed-load prescribed sets. The latest load and set-by-set reps
  appear beside each flag. This is a review cue, not a prescription to add load.

## High-priority follow-up fixes — completed

- **Imported ID injection:** all library, routine, workout, and set IDs are
  escaped where they enter HTML attributes, option values, and prefixed input
  IDs. Stored IDs remain unchanged so lookup and deduplication keep working.
  Tests restore and import IDs containing quotes, markup, event handlers,
  ampersands, and punctuation, then exercise affected UI actions. No injected attributes/elements or script execution occur. Numeric
  display/input fields are escaped as an additional boundary guard.
- **Backup validation and recovery:** `prepareBackup` validates the complete
  nested candidate, clones it, migrates and normalizes it, and validates the
  result. Startup and file/remote restores share this path. Validation checks
  collection/object shapes, required IDs/names, ID uniqueness in action-handler
  scopes, finite numeric fields, timestamps, booleans, timer fields, and active
  indices. Versions must be integers in the supported range. Legacy backups
  without app/kind markers remain supported; dangling library references are
  allowed because deleting a definition does not delete its history.
- Invalid restore candidates are rejected before confirmation and before any
  state/storage change. Callback errors are no longer mislabeled JSON syntax
  errors. Startup saves an exact recovery copy; if that fails or would overwrite
  an older recovery copy, automatic writes are blocked until explicit valid
  restore or clearing data. Transfer imports normalize numeric/duplicate set
  IDs and reject active-workout ID collisions to keep their own backups valid.

Verified with both browser suites. The security suite includes 27 invalid
backup cases, migrations for versions 1–8, hostile file/transfer IDs, UI editing,
remote restore rejection, cancelled restore, startup recovery, and rescue-write
failure. See `tests/README.md` for commands.

## Fixed in the earlier routine-pairing change

- Full backup restore previously migrated only through v3, unlike startup.
  Both now share the complete migration chain through v8.
- Full backup restore reset an active rest timer. It now restores that timer
  and cancels any beep scheduled for the previous session.
- Settings normalization overwrote its own fallback object, allowing an invalid
  theme/effort preference to survive. Defaults now stay intact.
- Routine import accepted fractional sets and changed zero reps to eight;
  editor/import/load now share target normalization. Negative planned weights
  are cleared. Missing import targets retain defaults of three sets/eight reps.
- Routine import now filters null/nameless exercise definitions and rejects
  blank routine names.
- The history field reference claimed RIR was enabled by default; the default
  is no effort column. The description now matches Settings. Duration is
  documented as a number, matching the importer, which retains fractions.
- Timed routine targets now read “Seconds” instead of “Reps”.
- Editing an exercise previously updated only the exercise definition while an
  active workout continued rendering its start-time snapshot. Name, category,
  notes, and compatible unit changes now refresh matching blocks in the active
  workout; finished History is unchanged. Measurement-kind changes begin with
  the next workout to avoid reinterpreting entered reps, weights, or seconds.

## Either-of feature, progression targets, and history reconciliation

State version is **9**; transfer contract version is **1.6.0**. Exactly two
routine items with different exercise IDs share an optional `eitherOf` string.
Invalid/incomplete groups become independent items. Each item keeps its own
sets, lower/upper reps or seconds, optional target RIR, and weight. Pairing,
unlinking, deletion, duplication, and
reordering are supported. Both alternatives enter a started workout; completing
one removes the other from that workout while preserving the saved routine.
The routine summary counts each pair once and shows a range for differing sets.

The downloadable routine sample now contains Back Squat or Leg Press, followed
by Plank. The history sample demonstrates a logged Back Squat session followed
by Plank, timed duration, RIR including zero, and warm-up exclusion flags.
Both samples use the real payload builders and were imported through the real
file-reader handlers in the browser. Export/reimport preserves pair keys.
Legacy single-target routines migrate that value into equal lower and upper
bounds. Unpaired routines otherwise require no field conversion.

History now derives progress candidates from workout snapshots rather than
requiring every historical ID to exist in the current Library. A reversible
link table can join true renames to a current exercise while preserving the
original workout record; reviewed variations can be kept separate or promoted
to the Library. Routine imports preserve safe source IDs, so separately
exported routines and history continue to line up. History import reports new,
already-present, invalid, and conflicting workouts independently, and a
duplicate-only import still offers exercise reconciliation.

## Verification

`tests/regression.cjs` exercises generated sample imports and precise deduplication,
export/reimport, migration/default handling, target normalization, invalid pair
cleanup, pair summaries, duplication, unlinking, deletion and reordering.
It also covers orphaned-history analytics, reversible linking, source-ID
preservation, and the review UI.
Browser interactions cover pairing through the editor at 390px width, completing
either alternative, per-exercise targets, full-backup restore and reload. A
touch-enabled 320px pass checks equal-width navigation, the compact History
grid, accurate copy, exercise reconciliation, and removal of keyboard-only
material. The test checks page errors and horizontal overflow; editor/workout
screenshots were inspected.
Tests use an isolated profile and synthetic origin.

Run with Node and Playwright installed: `node tests/regression.cjs`.
Set `BROWSER_PATH` to use an existing Chromium executable if needed.

# Code audit — 2026-09-20

Scope: the single-file application, persistence and migrations, routine editing
and workout construction, transfer payloads and samples, service worker, and
architecture notes. This is a targeted code review and browser regression pass,
not an exhaustive security or cross-browser audit.

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
backup cases, migrations for versions 1–7, hostile file/transfer IDs, UI editing,
remote restore rejection, cancelled restore, startup recovery, and rescue-write
failure. See `tests/README.md` for commands.

## Fixed in the earlier routine-pairing change

- Full backup restore previously migrated only through v3, unlike startup.
  Both now share the complete migration chain through v7.
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

## Either-of feature and sample JSON

State version is **7**; transfer contract version is **1.4.0**. Exactly two
routine items with different exercise IDs share an optional `eitherOf` string.
Invalid/incomplete groups become independent items. Each item keeps its own
sets, reps/seconds, and weight. Pairing, unlinking, deletion, duplication, and
reordering are supported. Start asks for one exercise per pair; Cancel creates
nothing. Only chosen exercises enter the workout, at each pair's first position.
The routine summary counts each pair once and shows a range for differing sets.

The downloadable routine sample now contains Back Squat or Leg Press, followed
by Plank. The history sample demonstrates a valid choice of Back Squat followed
by Plank, timed duration, RIR including zero, and warm-up exclusion flags.
Both samples use the real payload builders and were imported through the real
file-reader handlers in the browser. Export/reimport preserves pair keys.
Unpaired legacy routines require no field conversion.

## Verification

`tests/regression.cjs` exercises generated sample imports and deduplication,
export/reimport, migration/default handling, target normalization, invalid pair
cleanup, pair summaries, duplication, unlinking, deletion and reordering.
Browser interactions cover pairing through the editor at 390px width, cancel,
choosing an alternative, per-exercise targets, full-backup restore and reload.
The test checks page errors and horizontal overflow; editor/workout screenshots
were inspected. Tests use an isolated profile and synthetic origin.

Run with Node and Playwright installed: `node tests/regression.cjs`.
Set `BROWSER_PATH` to use an existing Chromium executable if needed.

# Enhancements for future versions

Ideas found while cleaning up the codebase, ordered by value per unit of effort.
Nothing here is required for the app to work today — these are the next things
worth doing. Each notes the constraint it puts pressure on, since the
single-file / zero-dependency property (see [README.md](README.md)) is the thing
most of them trade against.

---

## 1. Correctness and data safety

### 1.1 A test suite, and a seam to test through
**Why:** the app has no automated tests, and the logic worth testing (migrations,
import normalization, unit conversion, e1RM, volume) is sealed inside an IIFE
with no exports. Every change is verified by hand.

**How:** expose a small, explicit surface (`window.Liftlog = { migrateToV3,
normalizeImportedSet, epley, sumVolume, convertWeight, … }`) guarded so it is
obviously a test seam, then add a dependency-free `tests.html` that loads
`index.html` in an iframe and asserts against it. Serve over `http://` — a
`file://` iframe is cross-origin in Chrome. This keeps the zero-build property.
A Playwright suite over the real UI is the heavier alternative, and would be the
right call once a build step exists anyway.

### 1.2 Re-link history when v1 data is migrated
**Why:** `migrateToV2()` replaces the whole exercise library with new ids, so
every logged workout from a v1 install keeps pointing at exercise ids that no
longer exist. Their history still displays (the workout stores a `name`), but
previous-session lookups, bests and trends all silently return nothing for those
movements.

**How:** after swapping the library, walk `state.workouts` and re-point
`exerciseId` by case-insensitive name match, leaving genuinely unknown movements
unlinked.

### 1.3 Surface the rescued-data escape hatch in the UI
**Why:** unreadable data is now preserved under
`localStorage['liftlog.v1.unreadable']` and announced with a toast, but the only
way to get it back is the devtools console.

**How:** when that key exists, show a banner in Settings offering "download the
data we could not read" (as JSON) and "discard it".

### 1.4 Warn before a destructive import
**Why:** a full-backup import replaces everything, including an in-progress
workout, with only a generic confirm.

**How:** name what is about to be lost in the dialog (`"3 routines, 42 workouts
and a session in progress"`), and auto-export the current state to a rescue key
first so the import is undoable.

---

## 2. Features the data model already supports

### 2.1 Warm-up and PR flags as first-class UI
**Why:** `countForVolume` / `countForPR` exist, are honoured everywhere, survive
export/import, and are shown in history as a "warm-up" chip — but **nothing in
the UI can set them**. They only ever arrive from seed or import data.

**How:** a per-set toggle in the active-workout set row and the history editor.
This is the single largest gap between the model and the interface.

### 2.2 Added load on bodyweight exercises
**Why:** a `bw` exercise renders a disabled weight field, so weighted dips or a
loaded push-up cannot be logged. The seed data works around this by declaring
"Backpack Push-Up" as `kg`, which then misreports bodyweight volume.

**How:** allow an optional `+load` value on `bw` sets (the label already exists
in the design), and count `bodyweight + load` toward volume once a bodyweight
figure is known — which needs 2.3.

### 2.3 Bodyweight tracking
**Why:** bodyweight sets contribute zero volume, so a bodyweight-heavy session
looks like no work at all in the charts.

**How:** a bodyweight log in Settings (date + weight), used to value `bw` sets
and to draw a bodyweight trend. Relative strength (e1RM ÷ bodyweight) becomes
available for free.

### 2.4 Distance sets
**Why:** `distance` / `distanceUnit` are already normalized on import and
rendered by `setSummary()`, but no exercise unit produces them and no field
edits them. It is a half-wired feature.

**How:** either add `distance` to `UNITS` with proper editing and aggregates, or
remove the fields from the import contract. Half-support is worse than either.

### 2.5 Richer progress views
Per-muscle-group volume over time, set/rep tonnage per week, PR history for a
movement, and estimated 1RM trend lines against a target. The aggregation
helpers (`exerciseStats`, `sumVolume`) already do the hard part.

### 2.6 Plate calculator
Given a target weight, a bar weight and available plates, show the loading per
side. Small, self-contained, and genuinely useful mid-session.

---

## 3. Platform

### 3.1 Make it installable and offline-first (PWA)
**Why:** the highest-value change for a phone-first gym app. It already works
offline in the sense that it makes no network calls, but it cannot be installed
to the home screen and a browser cache eviction loses the tab.

**How:** add a web app manifest and a service worker that caches the single
document. Costs the single-file property (a manifest, a worker, and icons must
be separate files) and requires HTTPS or `localhost`, so it should be a
deliberate decision.

### 3.2 Wake lock during a session — **done**
`syncWakeLock()` holds a screen wake lock for as long as `state.activeWorkout`
is set, and re-requests it on `visibilitychange` since the browser drops the
lock whenever the page is hidden.

### 3.3 Timer that survives a backgrounded tab — **done**
The end-of-rest beep is queued in the audio clock when rest starts
(`scheduleRestBeep()`), which is sample-accurate and unaffected by the
throttling that delays the 250 ms tick. `completeRest()` only sounds an
immediate beep when scheduling was not possible, and settles a rest that
finished while the tab was hidden on the way back. A `Notification` would still
be the way to reach a user who has switched apps entirely.

### 3.4 Storage headroom
`localStorage` is a few MB and `save()` silently no-ops when full, so a long
history will eventually stop persisting without telling anyone. Either report
the failure or move to IndexedDB, which also removes the whole-state-per-write
cost.

---

## 4. Codebase

### 4.1 Split into modules once the file outgrows one document
`index.html` is ~3,000 lines. The section banners map cleanly onto ES modules
(`storage.js`, `timer.js`, `views/*.js`), and the delegated-table event design
means the split is mostly mechanical. This trades away `file://` support, so it
should wait until 3.1 forces a build step anyway. Do them together.

### 4.2 Replace string templates with a tagged helper
Views build HTML by concatenation, which is why `esc()` discipline has to be
manual. A tiny `html` tagged template that escapes interpolations by default
(with an explicit opt-out for trusted fragments) would make escaping the
default rather than a convention. Roughly 40 call sites.

### 4.3 Render only what changed
Every mutation rebuilds all of `#main`. It is fast enough at present scale, but
it forces the `ui.focus` dance and the no-re-render-on-keystroke rule. Keyed
child updates, or a small diff, would remove both workarounds.

### 4.4 Extract the seed program from the code
`sampleExercises()` / `sampleRoutines()` hard-code one person's training program
inside the application. Moving it to a JSON constant (or shipping it as an
importable routines file) separates "the app" from "my program" and makes the
sample data replaceable without touching logic.

### 4.5 Undo
`ui` and `state` are plain objects and `deepCopy` already exists, so a bounded
undo stack for destructive actions (delete routine/exercise, discard workout,
clear all) is cheap. Currently every one of them is a confirm-and-hope.

---

## 5. Accessibility and UX polish

- **Routine picker semantics.** The rows are a single-select group implemented
  with `aria-pressed` toggle buttons. `role="radiogroup"` + `role="radio"` with
  roving tabindex and arrow-key navigation would match the actual behaviour.
- **Reordering without buttons.** Routine items move with up/down icon buttons.
  Drag-and-drop (with a keyboard equivalent kept) would be faster for long
  routines.
- **Exercise search scope.** `/` filters by name and category only; searching
  notes would help now that notes carry machine codes and cues.
- **Focus after deletion.** Deleting a row returns focus to `<body>`; it should
  land on the next row or the list heading.
- ~~**Timer presets are fixed** at 60/90/120/180s.~~ **Done** — `restPresets()`
  offers the rest times the active session actually uses, current exercise
  first, and falls back to `REST_PRESETS` when a session has too few distinct
  values.
- **Empty-state guidance.** ~~A first-run walkthrough would beat the "load sample
  data" shortcut, which drops an opinionated program on the user.~~ The shortcut
  is gone, and Settings now documents the import format and hands out working
  sample files. A first-run walkthrough (create an exercise → build a routine →
  start it) is still the missing piece, and it matters more now that there is no
  one-click way to fill an empty app.
- **`seedState()` still ships one person's program.** Removing the "load sample
  data" button stopped the app *replacing* your library with the sample program,
  but a first run is still seeded with it (and `migrateToV2()` depends on those
  builders). Deciding whether a new install should start empty is a product
  call, not a cleanup: an empty app plus the first-run walkthrough above is the
  coherent alternative, and `sampleExercises()` / `sampleRoutines()` should
  become an importable routines file (see 4.4) rather than code.
- **A bottom tab bar for navigation.** The header nav now scrolls horizontally
  instead of pushing its last tab off-screen, but five text tabs is still the
  wrong pattern for a phone. A five-icon bottom bar would cost less height —
  and collides with the sticky action bar, so it needs a design that shares
  that edge.
- **The set row's floor is the 44px Done target.** Rows are 57px on a phone
  (was 74). Getting below that means rethinking how a set is marked done —
  swipe, or completing from the action bar only — not shrinking the button.
- **`--header-h` is measured, not declared.** `trackHeaderHeight()` writes the
  header's height to a custom property so the session strip can stick beneath
  it. A layout that did not need JS to know a CSS value would be better; it
  needs the header to have a height CSS can state, which the scrolling nav
  currently does not.

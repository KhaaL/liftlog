# Enhancements for future versions

Ideas found while cleaning up the codebase, ordered by value per unit of effort.
Nothing here is required for the app to work today — these are the next things
worth doing. Each notes the constraint it puts pressure on, since the
single-file / zero-dependency property (see [ARCHITECTURE.md](ARCHITECTURE.md))
is the thing most of them trade against.

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
workout, with only a generic confirm. Feeding it the *wrong kind* of file is now
refused outright (files carry `kind`, and `applyFullBackup()` turns away a
routines or history file), but a genuine backup still replaces the lot on one
generic "Import & replace".

**How:** name what is about to be lost in the dialog (`"3 routines, 42 workouts
and a session in progress"`), and auto-export the current state to a rescue key
first so the import is undoable.

---

## 2. Features the data model already supports

### 2.1 Warm-up and PR flags as first-class UI — **done**
A set can be marked a warm-up from the set row (the set number doubles as the
toggle), by long-pressing its box in the done column, and from the history
editor, so a past session can be reclassified too. `setWarmup()` writes
both flags together: a warm-up is performed but counts for neither volume nor
records, which is how the seed and the import contract have always used the
pair, and one control cannot honestly claim to set them independently. Turning
it off deletes the keys rather than writing `true`, so a file keeps carrying the
exception rather than the rule.

Two entry points rather than one because the set-number cell is 34px at 480px,
30px at 400px, and is dropped altogether below 360px when an effort column is
on — so it cannot be the only way in, and because a long press has no keyboard
equivalent at all. The gesture is the fast one on a phone (the done cell is
already under the thumb) and the set number is the discoverable one; the done
cell carries the warm-up colour too, since it is now where the flag is set.

### 2.2 Added load on bodyweight exercises
**Why:** a `bw` exercise renders a disabled weight field, so weighted dips or a
loaded push-up cannot be logged. Working around this by declaring the exercise
as `kg` instead then misreports bodyweight volume.

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

### 3.1 Make it installable and offline-first (PWA) — **done**
`manifest.webmanifest` plus `sw.js` cache the document and its icons, so an
installed app opens with no network. The document is served
stale-while-revalidate: an offline launch is instant, and an edited
`index.html` is picked up on the next launch, so `sw.js`'s `CACHE` name only
needs a new version when the *file list* changes. The page never reloads
itself when an update lands — it says so in a toast and waits, because an
unasked-for reload mid-set is worse than one stale session.

This was the deliberate decision the original entry called for: it cost the
single-file property (four static files now sit beside `index.html`, icons
generated by `tools/make-icons.py`) but added no build step, and a `file://`
open still works with the worker simply absent. Beyond offline, installing is
what exempts the stored log from the storage clearing iOS applies to sites not
visited for a week.

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

### 3.4 Embed the UI font instead of hoping for it
**Why:** `--font-ui` and `--font-mono` name only open-source families, but
naming a font is not shipping one. On a machine with none of them installed the
generic `sans-serif` keyword decides, which on macOS and Windows means a
proprietary face — the opposite of the intent.

**How:** subset Inter (and JetBrains Mono) to Latin, and inline each weight as
a `@font-face` with a `data:` URI. That keeps both hard constraints — one
document, no network calls — and is the only way to actually guarantee the
typeface. It costs file size: roughly 20–30 KB per weight as WOFF2, ~35–40 KB
once base64-encoded, so three weights plus a mono is on the order of 150 KB
against a document that is currently ~200 KB. The OFL also requires shipping
the licence text, which means a second file or a large comment block. Worth
doing only if the typeface matters more than the single-file size; otherwise
the current preference list is the honest compromise.

### 3.5 Storage headroom — **reporting done, IndexedDB still open**
`save()` no longer fails silently: it sets `saveFailed` and shows a permanent
banner offering a download, and Settings reports bytes used, the browser's
quota estimate, and which of four durability states this browser is in —
granted, askable, refused outright (Brave), or unable to say because
`StorageManager` needs a secure context. The last two used to read as
"best-effort" and "checking…" forever, which told the user nothing they could
act on; each now names the one thing that still helps, and the request button
is only offered where pressing it can change the answer.

What remains is the storage engine itself. `localStorage` is still a few MB,
synchronous, and rewritten in full on every keystroke. IndexedDB would remove
the whole-state-per-write cost and raise the ceiling; it is a bigger change
than the reporting was, and no longer urgent now that hitting the ceiling is
visible rather than silent.

---

## 4. Codebase

### 4.1 Split into modules once the file outgrows one document
`index.html` is ~3,000 lines. The section banners map cleanly onto ES modules
(`storage.js`, `timer.js`, `views/*.js`), and the delegated-table event design
means the split is mostly mechanical. This trades away `file://` support, so it
should wait until something else forces a build step. Note that 3.1 did *not*:
it added static files beside the document, not a build, and `file://` still
works — so this one now has to justify itself on its own.

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
- **Reordering without buttons — done.** Both lists that sort do it by a grip:
  the session sheet's upcoming exercises and the routine editor's items. Each
  handle answers the arrow keys too, and the up/down buttons stay beside it.
- **A drag does not scroll the list it is in.** Dragging a row to the edge of
  the session sheet or the routine editor stops there rather than scrolling the
  list under it. It matters from roughly eight rows up, which no seed routine
  reaches; the fix is a rAF loop in `sortMove()` while the pointer sits within
  ~40px of an edge, and it would serve both lists at once.
- **Exercise search scope.** `/` filters by name and category only; searching
  notes would help now that notes carry machine codes and cues.
- **Focus after deletion.** Deleting a row returns focus to `<body>`; it should
  land on the next row or the list heading. Reordering no longer has this
  problem in either list — a move puts focus back on the control that made it —
  so `overviewStep()` / `routineStep()` are the pattern to copy.
- ~~**Timer presets are fixed** at 60/90/120/180s.~~ **Withdrawn** — the
  presets and the action-bar sheet that held them are gone. Rest length is a
  decision made once, in Settings or on the exercise, and `+0:30` covers the
  one-off; a sheet of alternatives was a second place to configure the same
  number, on the screen with the least room for one.
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
- **Reps need the keyboard when a set goes off plan.** `repChips()` answered
  this with five tap targets around the planned value, and has been removed: a
  strip of chips under the row being logged doubled the height of the one row
  that has to stay in view, to save a keystroke on a field that is already
  pre-filled with the plan. Any second attempt has to fit *inside* the row —
  stepper affordances on the field itself, say — not under it. Weight has the
  same problem and never had chips.
- **The set row's floor is the 44px Done target.** Rows are 57px on a phone.
  Getting below that means rethinking how a set is marked done — a swipe, say —
  not shrinking the button, and the done cell now also carries the long-press
  warm-up toggle, so whatever replaces it has to carry two gestures.
- **The software keyboard still covers the action bar.** The bar is pinned to
  the layout viewport's bottom edge, which iOS does not shrink when the
  keyboard opens, so focusing a weight field hides the rest timer behind it.
  `visualViewport`'s `resize`/`scroll` events are the fix (translate the bar by
  `innerHeight - visualViewport.height - visualViewport.offsetTop`); it is the
  one piece of mobile layout that cannot be done in CSS. Low urgency: the pager
  moved to the strip, so nothing you need *while typing* is down there any
  more, and the timer is not usually running while you type.
- **Deleting an unlogged set is still one tap with no way back.** Only a
  completed set raises a confirm, on the reasoning that an empty row is a plan
  rather than data. That reasoning holds for a mouse. On a phone the control
  sits one column from the target a thumb aims at between sets; it now gives up
  8px of its column under a coarse pointer, which reduces the mis-tap without
  removing it. An undo (4.5) is the real answer, and would let the confirm on a
  logged set go too.
- **Landscape is usable, not designed for.** `@media (max-height:560px)` gets a
  phone on its side down to roughly one visible set row at the top of the page;
  the rest are a scroll away, behind a strip and an action bar that both stay
  put. Going further means the routine name and *Finish* giving up their row —
  which needs *Finish* to have a second home first (the session sheet is the
  obvious one, and it already holds *Discard*).
- **Gestures have one owner — done.** One pointer pipeline, recognisers in
  `GESTURES`, list behaviours in `SORTABLES` (see **Gestures** in
  [ARCHITECTURE.md](ARCHITECTURE.md)). The next gesture is a recogniser; the next sortable
  list is three facts. What is still open is one pointer only: pinch and rotate
  would need the pipeline to track a map of active pointers and hand
  recognisers a set rather than a point, which is a rewrite of the pipeline
  rather than an addition to it, and nothing in the app has asked for it.
- **`--header-h` is measured, not declared.** `trackHeaderHeight()` writes the
  header's height to a custom property so the session strip can stick beneath
  it. A layout that did not need JS to know a CSS value would be better; it
  needs the header to have a height CSS can state, which the scrolling nav
  currently does not.

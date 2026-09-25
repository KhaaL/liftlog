# Architecture

The technical reference: how the code is organized, the render loop, gestures,
layout decisions, the data model, storage durability, import/export, and what
to exercise by hand before a release. For what the app is and why, see
[README.md](README.md).

## Running it

Open `index.html` in a browser. That is still the whole install step, and it
still works from a `file://` URL or a USB stick.

The application is **one document with no build step and no dependencies**:
`index.html` is the entire app. A few small static files sit beside it purely
to make it installable — `manifest.webmanifest`, `sw.js`, and `icons/`
(regenerate with `python3 tools/make-icons.py`, standard library only). Nothing
is compiled, bundled or fetched at any point; opening the file directly simply
skips them. Please keep it that way — see [ENHANCEMENTS.md](ENHANCEMENTS.md)
before adding anything that needs a build step. `package.json` does not change
this: its one dependency is Playwright, for the browser tests, and nothing in
it is shipped or needed to run the app.

By default the app also makes **no network calls at all**. The two exceptions
are the optional remote storage feature below, whose requests go directly from
your browser to storage you configure and never through any server, and the
service worker, which only ever caches the app's own files.

### Installing it

Served over `https://` (or `localhost`), Liftlog can be installed to a home
screen or desktop, and then opens with no network at all. Any static host will
do; `python3 -m http.server` is enough to try it locally.

Installing is worth more than the convenience. iOS clears a *site's* stored
data after roughly a week without a visit, but leaves an installed app's data
alone — so on an iPhone, installing is the difference between a training log
that survives a holiday and one that does not. From a `file://` URL there is no
service worker and no install prompt; everything else behaves as it always has,
except remote storage, which needs a secure context for the Web Crypto API.

## Architecture

One file, three parts: `<style>`, static `<body>` markup, and one `<script>`
holding an IIFE. Within each part, sections are marked by banner comments
(`/* ===== NAME ===== */`) and appear in dependency order.

### The script, top to bottom

| Section | Responsibility |
| --- | --- |
| `UTILITIES` | Formatting, escaping, numeric coercion, unit conversion, icons |
| `DOMAIN CONSTANTS` | The closed vocabularies: units, themes and their light/dark scheme, bounds, shortcuts |
| `STORAGE` | `localStorage` read/write, schema migrations, normalization |
| `REMOTE STORAGE` | Optional S3-compatible backup/restore, config, request signing |
| `SEED / SAMPLE DATA` | The starting exercise library and program routines |
| `STATE` | `state` (persisted) and `ui` (transient), navigation |
| `FEEDBACK` | Toasts, screen-reader announcements, the confirm dialog |
| `REST TIMER` | Timer model, persistence across reloads, the scheduled alarm, wake lock, painting |
| `PERFORMANCE LOOKUPS` | Per-exercise history aggregates |
| `ACTIONS — *` | State mutations, grouped by the screen that triggers them |
| `RENDERING` | `render()` plus pure `viewX()` / `htmlX()` string builders |
| `EVENT HANDLING` | Delegated `click` / `input` / `change` / `submit` listeners |
| `KEYBOARD SHORTCUTS` | Global key handling |
| `INIT` | Theme and system-bar colour, timer restore, first paint |

### The render loop

There is no framework. The loop is:

1. An event handler mutates `state` (persisted) or `ui` (transient) and calls
   `render()`.
2. `render()` clears the stats cache, settles dangling selections, rebuilds
   `#main` with `main.innerHTML = viewHTML()`, repaints the timer, and applies
   any pending focus.

Two rules keep that honest:

- **View builders are pure.** They read `state` and `ui` and return a string.
  They must not mutate anything — selections that can dangle (a deleted routine,
  a deleted trend exercise) are settled in `normalizeSelections()` before the
  templates run.
- **Focus is declared, not applied.** Set `ui.focus = '<element id>'` *before*
  calling `render()`; `applyFocus()` consumes it once. Never call `applyFocus()`
  by hand after a render.

Because a full re-render would drop the caret, text fields do **not** re-render
on every keystroke. They write straight to state through the `binders` table
(see below) and are rebuilt only when something else forces a render.

### Event handling

Four delegated listeners on `document`, each backed by a lookup table, so a new
control is a new table entry rather than a new listener:

| Attribute | Table | Fires on |
| --- | --- | --- |
| `data-action="…"` | `actions` | click |
| `data-bind="…"` | `binders` | input (per keystroke, no re-render) |
| `data-change="…"` | `changeHandlers` | change (commit-on-blur controls, file pickers) |
| `data-form="…"` | `submit` listener | form submit |
| `data-longpress="…"` | `actions` | a 500ms hold (see **Gestures**) |
| `data-drag="…"` | `SORTABLES` | a drag of the row the handle is in |

Handlers receive the element's `dataset`, so parameters travel as `data-id`,
`data-idx`, `data-field`, `data-sid`.

## Gestures

One pointer pipeline, several recognisers, and behaviours on top. There used to
be two hand-rolled implementations — a long press and a drag — because they
want opposite things from the same 10px of movement: one abandons the press
there, the other only begins. Everything else they shared, and it was the
fiddly half.

| Layer | Job | Where |
| --- | --- | --- |
| press pipeline | the four pointer events, once, for every gesture | `pointerdown`/`move`/`up`/`cancel` on `document` |
| recogniser | when a press becomes a gesture, and what it does then | `GESTURES` |
| behaviour | what a recognised gesture means to a particular list | `SORTABLES` |

The pipeline owns exactly what both gestures had to get right separately:
which element a press belongs to, ignoring secondary buttons, the origin and
delta, tearing down on every path a touch stack does not guarantee (a press
that ends without a click, an element re-rendered mid-press, a sheet closed
underneath a drag — `cancelGesture()` is that last one's hook), and swallowing
the click a recognised gesture leaves behind.

A recogniser declares when it fires and what it does: `hold` recognises on a
timer, `slop` alone on the first move past it, neither on the pointerdown
itself. `cancelOnMove` / `cancelOnScroll` say what abandons a press before it
is recognised; `grab` stops a selection starting; `swallow` eats the trailing
click. `onStart` and `onRecognise` may return `false` to decline — which is how
a future swipe would test its axis at the moment it has a delta to test.

So a new gesture is a recogniser (a swipe to reveal a row's actions:
`{ slop:14, onRecognise, onMove, onEnd }`), and a new sortable list is an entry
in `SORTABLES` naming its container, its row, and what a move means. Neither
touches the pipeline. The deliberate limit is one pointer: pinch and rotate
would be a different pipeline rather than a recogniser, and nothing here wants
one.

**Two lists sort**, and they share everything but those three facts: the
session sheet's upcoming exercises and the routine editor's items. Both reorder
under the finger rather than at the drop, both commit through the same
`drop(from, to, focus)`, and the arrow buttons beside each handle are a drag of
exactly one place through that same function — they differ only in where focus
goes afterwards. Indices are positions among the rows on screen, which is what
both models want and what a drop has to compute anyway.

## Layout on a phone

The active-workout screen is built around a fixed vertical budget, because a
phone in a gym is the case that matters:

- **The session strip is the pager** (`.session-strip`, `htmlSessionStrip()`).
  Sticky directly under the header, it answers "where am I" — exercise *n* of
  *m*, sets done, a finish estimate, one progress segment per exercise
  weighted by its set count — and it is also how you move: `‹` and `›`
  at the two ends, 44px each. It sticks at `top:var(--header-h)`, which
  `trackHeaderHeight()` keeps in sync with the header's real height, so those
  two controls occupy the same pixels for the whole session.

  They used to live at the bottom of the action bar, and that is the reason
  they moved. A sticky bottom edge is a function of everything above it: a
  two-set exercise put **Next** in one place and a six-set exercise put it
  ~80px lower, and scrolling to the end of the page moved it again by the
  footer's height. Nothing about a pager should depend on how many sets an
  exercise happens to have. On the last exercise the forward
  button carries the finish icon and is labelled *Wrap up*, so the arrow never
  lies about what is on the other side of it.
- **The action bar** (`.actionbar`, `htmlActionBar()`) is sticky along the
  bottom edge and holds the rest timer. It replaced a full-width timer panel
  that rendered around 500px below the fold, so on a phone the timer was
  off-screen at exactly the moment a logged set started it. A set is *not*
  logged from here: that is the done column's job (`toggleSet()`), which is
  also what starts auto-rest. Nothing is stacked below it — the completed
  exercises used to be listed there as
  "Earlier in this workout", which put a second, half-overlapping account of the
  session under the one you were logging into. That list lives in the session
  sheet (`#overview-dlg`) and nowhere else.

  `position:sticky` with `bottom` only ever pulls an element *up* into the
  scrollport; it never pushes one down. A bar whose static position is already
  above the fold — a two-set exercise — is therefore not pinned by anything. So
  `html.session-active` (set in `render()`) makes `main` a screen-tall
  (`100dvh`) flex column with `margin-top:auto` on the bar and no footer
  beneath it: the bar's static position *is* the bottom edge, in both the short
  and the long case.
- **The session as a whole is a modal sheet, not another panel.** The strip's
  middle — position, counter and estimate, the full width between the two
  arrows — opens `#overview-dlg`: full-screen on a phone, a centred 560px
  card on a desktop, over a scrim that dims the workout. It answers one
  question — what am I doing next, in what order — and it used to answer it as
  a panel rendered directly under the action bar, in the same visual language
  as the exercise being logged, which read as more of the same screen rather
  than a different question. The dialog is static markup outside `#main`, so a
  render refills only `#overview-dlg-body` (`overviewSheetHTML()`): calling
  `showModal()` on an open dialog throws, and rebuilding the element would
  flash the backdrop on every reorder.

  **Upcoming exercises reorder by dragging their grip** — the app's second
  gesture, on pointer events because HTML5 drag and drop is not fired by any
  mobile browser. The grip and nothing else starts a drag, and it is the only
  element with `touch-action:none`, which is what leaves the rest of a
  full-screen sheet scrolling: a whole draggable row could not tell a drag from
  the scroll it began as. The list reorders under the finger, so what you see
  when you let go is what you get, and closing the sheet abandons a drag rather
  than dropping it. The grip answers the arrow keys too; the up/down buttons
  stay beside it, because a grip does not announce what it can do to anyone who
  is not already holding it.

  Both ways of reordering — and only these two — commit through
  `reorderMovable()`, over the positions `movableIndices()` reports. Those are
  the exercises the sheet draws with a grip: the current one, plus everything
  still to come that has not been skipped or already finished. It is the
  negation of `isSettledRow()`, which `overviewSheetHTML()` also branches on,
  so the list that can be dragged and the list drawn with a grip cannot drift
  apart. It is a list of positions rather than a range because they are not
  always contiguous — jumping back to an earlier exercise leaves anything you
  had already finished sitting among the ones still to come. Reordering deals
  the exercises back into the same set of positions, so no settled row (nor
  `ui.expandedDone`, which is keyed by index) can move however far a row
  travels.

  **The current exercise is in that set, and moving it hands "Now" over.**
  `currentExerciseIndex` names a position, not an exercise, and a reorder
  preserves the set of positions — so dragging the current exercise later
  leaves its position occupied by whatever was dealt into it, and that becomes
  the exercise being worked on. This is the point rather than a side effect:
  "I'll come back to this one" is a decision made standing in front of an
  occupied machine. It is also why the current exercise is always the lowest
  movable position and so can only move later, and why the drop announces the
  new `Now:` — the screen behind the sheet changes exercise, and that must not
  be silent.

  `syncOverviewSheet()` runs before
  `applyFocus()`, because `showModal()` takes the focus and whatever the render
  asked for has to be put back after it — including focus the refill itself
  destroyed.
- **Everything occasional is one tap away, not always on screen.** Adding an
  exercise and discarding the workout live in that sheet; the
  session note collapses to a button until it has content; the optional effort
  column (RPE, RIR, or none) is a Settings-level choice
  (`settings.effortMetric`), off by default. Rest length is not a per-session
  control at all: it comes from the exercise, else from `settings.defaultRest`,
  and `+0:30` covers the one-off.
- **Column templates are one custom property.** `--sets-cols` on `.sets` has a
  variant per shape (`.no-rpe`, `.no-weight`) rather than four grid
  declarations, and the narrow breakpoint overrides the same four.
- Below 640px the per-row field captions are hidden — the head row already
  names the columns — so every set input carries an explicit `aria-label`.
- **Each fact is on screen once.** The exercise name lives in exactly one
  place — the workout-pad heading (`.ex-name`) — not in the per-exercise
  `.ex-head` it used to duplicate, and not in the session strip's pager,
  which shows position (`n/m`) only. Below 640px the heading truncates with
  an ellipsis rather than wrapping, since that row also has to fit the Finish
  button. For the same reason `.prev-perf` becomes one horizontally-scrolling
  line there — the last session, the figure you act on, stays in view and the
  bests are a swipe away rather than a screenful (128px down to 38px).
- **Short viewports are their own case, not a narrow one.** A phone in
  landscape is wider than 720px and about 360px tall, so every rule keyed on
  width alone gave it the desktop treatment and left no room for a single set
  row. `@media (min-width:720px)` therefore also requires `min-height:600px`,
  and `@media (max-height:560px)` drops what can be read elsewhere: the
  exercise's standing note, the session totals, the progress segments.

### Safe areas

The viewport is `viewport-fit=cover`. That is what lets the action bar paint
into the bottom gesture area instead of floating above a letterboxed strip —
but it opts the **whole document** in, top edge included, and every edge that
is opted in has to pay its inset back.

| Edge | Who pays it |
| --- | --- |
| Top | `.app-header` — `padding-top:env(safe-area-inset-top)` |
| Bottom | `body`, `.actionbar`, `.toast` |
| Top, in a sheet | `.sheet-head` |

The top one was missing, and the symptom was the whole point of the inset: on
any device with a non-zero top inset — a notch, and every installed PWA since
Chrome began drawing Android's system bars edge-to-edge — the tab row was laid
out at `y=0`, underneath the clock and the status icons. The app's pixels and
the system's in the same place, with the system's on top.

The padding sits on `.app-header` rather than on `.header-inner` deliberately:
that way the header's background **fills** the strip as well as clearing it, so
what shows through a transparent system bar is this app's surface colour rather
than whatever it would otherwise composite against. The header is
`position:sticky; top:0`, so the strip stays painted while the page scrolls.

Clearing the strip is only half of it, though — see **The glyphs are not ours**
below for what happens *in* it.

One consequence worth knowing about: the header's height is now partly padding,
and `trackHeaderHeight()`'s `ResizeObserver` must therefore observe
`{ box:'border-box' }`. The default is the *content* box, which a padding change
does not touch — so a changing inset would move the header without ever firing
the observer, leaving `--header-h` stale and parking the session strip
underneath the header.

## Looking at one item: the detail sheet

Routines, Exercises and History are three lists with the same question behind
every row: *what is in this one?* They used to answer it three ways. A routine
could only be looked into by opening its editor; an exercise showed what fit on
its row and nothing more; a session rolled open inline, pushing the rest of the
list down under it. Each row also carried its own strip of buttons, four of
them on a routine and an exercise, which on a phone was most of the row.

There is now one answer: **tap a row, and the item opens in a sheet.** It is
the session sheet's frame (`.dlg-sheet`: full-screen on a phone, a centred
560px card on a desktop, over a scrim) as a second static dialog,
`#detail-dlg`, driven by `ui.detail = { kind, id }`. A kind is one entry in
`DETAIL_SHEETS`, which names its view, how to find the item, and four pure
builders: title, subtitle, body and footer actions. The frame, its refill,
its focus handling and its closing are shared with the session sheet
(`refillSheet()`, `wireSheet()`), so a fourth kind is one entry.

| Kind | Body | Footer (primary last) |
| --- | --- | --- |
| `routine` | every exercise in order with its target — sets × range, load, RIR, the same words as the workout's target tag — and what was lifted last time; either-of and superset pairs keep the editor's bracket | Delete · Duplicate · Edit · **Start** |
| `exercise` | its definition, note and how-to link; bests, the last five sessions, the routines that use it | Delete · Merge… · Archive/Restore · **Edit** |
| `workout` | duration, sets and volume (the row hides them on a phone), the note, every exercise's completed sets | **Edit session** |

The rules that make it one pattern rather than three:

- **The sheet is for looking.** Nothing in it is editable. **Edit** closes it
  and opens the item's editor where each kind has always been edited — the
  routine editor in place of the list, an exercise's form in its row, a
  session's editor under its row — and focuses the editor's container, which
  scrolls it into view without putting a phone keyboard over the form
  (`editFromDetail()`). One editor per kind, not a second one inside a sheet.
- **The row is the target.** `.list-open` is one button stretched over the
  whole `<li>` by its `::after`, named by the item alone
  (`aria-label`) and described by its summary line (`aria-describedby`), so a
  screen reader does not read the whole row as the button's name. A link cannot
  sit inside a button, so the exercise how-to link moved into the sheet.
- **A row keeps at most its one frequent action.** A routine's **Start** stays
  on the row, beside the button and above the stretch, because starting is what
  that list is for; below 560px it takes a line of its own so the name keeps
  the full width. Everything else is in the footer.
- **The footer has a fixed order.** The destructive action alone at the left,
  the primary at the right; on a phone the primary takes the bottom row to
  itself, under the thumb, however wide the other labels happen to be.
- **Closing returns focus to the row** (`closeDetail()`), whichever way it
  closes — the X, Esc, the scrim, Android's back gesture. A sheet belongs to its
  view: navigating away closes it, and `normalizeSelections()` drops one whose
  item has gone (deleted from the sheet itself, or replaced by an import).
- **Some flows arrive at a sheet.** *View last session* on a load result opens
  that session's sheet focused on the exercise; finishing a workout opens the
  finished session's sheet as its summary; duplicating a routine from its
  sheet moves the sheet to the copy, which is what you want to edit next.

Both sheets rise into place (`sheet-in`, 200ms) instead of appearing, so they
read as a layer over the page rather than the page changing; only on opening,
since a refill never restarts it, and reduced motion turns it off with
everything else.

A toast raised while a sheet is open would be painted under it — everything
that is not in the top layer is — so `#toast-region` is a manual popover that
`toast()` re-shows above whichever dialog opened since, and `liftToasts()`
lifts it clear of an open sheet's footer the way it clears the action bar.

## Touch

The primary device is a phone held in one hand in a gym, which is a set of
concrete constraints rather than a style. They are collected under `TOUCH` at
the end of the stylesheet:

- **Every `:hover` rule in the app lives in one `@media (hover:hover)` block.**
  A touchscreen has no pointer to move away, so `:hover` latches onto whatever
  was tapped last and stays there — which lit the delete control beside a
  logged set bright red and left it that way for the rest of the exercise. Two
  of the moved rules gained a `:not()` (`.list-row:not(.is-editing)`,
  `input:hover:not(:focus)`) to keep the state they used to lose to source
  order.
- **Fields are 16px under a coarse pointer.** iOS Safari zooms the page in
  whenever a field below that takes focus, and does not zoom back out; at the
  13px used elsewhere that fired on every weight and rep field. It is a
  threshold, not a type choice.
- **44px is the floor on the logging path** under `pointer:coarse` — buttons,
  fields, set rows, nav tabs. The delete control is the deliberate exception:
  it keeps its column but gives up the left 8px of it, so a thumb that misses
  Done to the right lands on nothing.
- `-webkit-tap-highlight-color:transparent` and `touch-action:manipulation`,
  because the platform's tap flash fights `.btn:active` and double-tap-to-zoom
  delays every control that sits close to its neighbour by design.

## Data model

```
state
├─ version         schema version (SCHEMA_VERSION)
├─ settings        { theme, unit, defaultRest, autoRest, sound, vibrate, effortMetric,
│                    lastFileBackupAt, lastModifiedAt, seededAt, historyLinksDismissedKey }
├─ exercises[]     { id, name, category, movementFamily, unit, loadMode,
│                    equipmentKey, archived, notes, url }
├─ exerciseLinks[] { sourceId, targetId } — persisted “same progression series” join
├─ historySeparateIds[] historical IDs explicitly kept as their own series
├─ progressionPreferences[] { exerciseId, loadCuesOff, dismissedExposureKey }
│                    — per-series load guidance, including historical IDs
├─ bodyweights[]   { id, loggedAt, weight, unit } — dated bodyweight log, newest first
├─ routines[]      { id, name, items[] }                      — the plan
│   └─ items[]     { id, exerciseId, sets, repsMin, repsMax, targetRir?, weight, eitherOf?, supersetOf? }
├─ workouts[]      logged sessions, newest first              — the log
│   └─ exercises[] { exerciseId, name, category, movementFamily, unit, loadMode,
│                    equipmentKey, targetRepsMin, targetRepsMax,
│                    targetRir?, skipped, eitherOf?, supersetOf?, sets[] }
│                    — supersetOf only while active; activeWorkout also has supersetSide
│       └─ sets[]  { id, weight, addedWeight?, addedWeightUnit?, reps, durationSeconds, rpe, rir,
│                    unit, completed, completedAt,
│                    countForVolume?, countForPR? }   — absent means "counts"
└─ activeWorkout   a workout in progress, or null
```

Workout exercise blocks copy their exercise definition when a session starts.
Finished blocks remain immutable history. While a workout is active,
`saveExerciseDraft()` refreshes the matching block's name, category, movement
family, load convention, equipment key, notes, and compatible unit so corrections appear immediately. A change between weighted,
bodyweight, and timed measurement is deferred until the next workout because
reinterpreting existing set fields would corrupt work already entered. The
how-to URL is always read from the current exercise definition.

For a Library exercise, `unit` chooses the measurement kind: weighted (`kg` or
`lb`), bodyweight, or time. Weighted definitions are always normalized to
`settings.unit`; kg/lb is one global display and planning preference rather than
a competing per-exercise choice. A logged set keeps its own kg/lb unit forever.
`loadMode` states whether that number is total, per hand, a machine stack, or
added bodyweight load; `equipmentKey` distinguishes otherwise similar machines.
`category` is a broad Push/Pull/Legs/Hinge/Core/Cardio reporting bucket, while
`movementFamily` groups related work such as `horizontal_push` without joining
their load progression. Archived definitions stay available to History and
Progress, but are hidden from the normal library and add-exercise pickers.

A bodyweight set keeps external load in `addedWeight` / `addedWeightUnit`; its
`weight` is null. `bodyweightAt()` chooses the newest bodyweight entry on or
before the workout date. That dated baseline plus added load drives volume,
estimated total 1RM, and progression load. Sessions before the first bodyweight
entry retain reps-only progress and do not invent tonnage.

### Durability

The log lives under one `localStorage` key (`liftlog.v1`). `save()` marks the
state dirty and coalesces bursts into one write after 300 ms; lifecycle exits,
restores, and other durability boundaries call `flushSave()` immediately.
Three things guard it, because `localStorage` is neither guaranteed nor
permanent:

- **Failed writes are visible.** `save()` still keeps the app working from
  memory when a write throws (quota exhausted, or storage blocked as in private
  mode), but it also sets `saveFailed` and shows a permanent banner offering a
  download. Losing a session silently is the one outcome worth being loud about.
- **Storage asks not to be evicted.** `requestPersistence()` calls
  `navigator.storage.persist()` on the first workout started in a browser — a
  real gesture, which is when a grant is most likely. Settings reports one of
  four answers (`storageState`), because the difference decides what the user
  should do about it:

  | State | What it means | What Settings offers |
  |---|---|---|
  | `persistent` | Granted. | Nothing to do. |
  | `best-effort` | Not granted, but askable. | The request button. |
  | `declined` | The browser refuses durability outright — Brave does, and a `persistent-storage` permission of `denied` says so before we even ask. | No request button (it cannot succeed); a backup button and the install hint instead. |
  | `unavailable` | No `StorageManager`: it is exposed only in a secure context, so `file://` and plain `http://` on a LAN — both supported ways to run this — have no API to ask with. | A backup button. |

  A refusal is sticky (`setStorageState()` will not fall back to
  `best-effort`), a refused `persist()` is confirmed against `persisted()`
  before being believed, and every path — including a rejected promise —
  ends in one of the four. "Checking…" is a transient, not a resting state:
  it used to be the permanent answer whenever `navigator.storage` was
  missing. Brave is named in the copy when `navigator.brave.isBrave()`
  confirms it, since "your browser refuses this" is only actionable if you
  know which lever to pull.
- **Staleness is surfaced.** `lastBackupInfo()` takes the newer of the last file
  export (`settings.lastFileBackupAt`) and the last remote backup
  (`lastBackupAt` in the remote config). Past `BACKUP_NAG_WORKOUTS` sessions or
  `BACKUP_NAG_DAYS` days, Settings marks it and one toast follows a finished
  workout. `workoutsSinceBackup()` is derived from the log rather than counted
  into state, so it stays correct across an import, a restore or a deletion.
  With no backup at all the cut-off is `settings.seededAt`, so the sample
  sessions a first-time user has never looked at are not counted as work at
  risk.

### Invariants

- **`state.workouts` is always newest-first.** Anything that can change a start
  time (finishing, importing, editing a session date) calls `sortWorkouts()`.
  `sortedWorkouts()` is just a readable name for that guarantee.
- **`reps` is a pure count.** Timed work lives in `durationSeconds`. Writing
  seconds into `reps` is the v2 bug that the v3 migration exists to undo, so
  every default-filling path goes through `fillSetDefaults()`.
- **A set keeps the unit it was logged in, forever.** Aggregates convert to the
  current display unit via `setWeight()`, so totals stay comparable after a
  kg/lb switch. Switching units rewrites the *active* session's sets and re-tags
  their `unit` — converting the value without re-tagging would convert twice.
- **Set bounds do not depend on the entry path.** `normalizeSetNumber()` and
  `normalizeSetMeasurements()` apply the same nonnegative weight/duration,
  integer reps/RIR and 1–10 RPE rules to active logging, history editing,
  transfer import and full-backup restore. A workout end before its start is
  pulled up to the start on edit, import and restore.
- **A completed set is a record, not a plan.** Nothing that propagates a
  planned value may touch one. `cascadeWeight()` writes a committed weight down
  to every later set in the exercise, skipping completed ones; `deleteSet()`
  asks before removing one, and does not ask otherwise (`addSet()` pre-fills a
  new row from the set above it, so "this row has a weight in it" says nothing
  about whether the user typed anything).
- **`ui.expandedDone` is keyed by position in `activeWorkout.exercises`.**
  Anything that inserts or removes an exercise invalidates every key after it,
  so it is cleared — see `confirmExerciseRemoval()`. Reordering never does:
  `isSettledRow()` keeps every done and skipped position out of the movable
  set, so the rows that key is about cannot move.
- **Execution and analytics are separate.** `completed` says the set was
  performed; `countForVolume` / `countForPR` (default true) say whether it counts
  toward totals and records. A warm-up is `completed: true` with both flags
  false — it is still shown in history, marked as a warm-up.
- **There is exactly one rest length, and it is `settings.defaultRest`.** Rest
  used to live on each routine item, seeded from that setting and then
  hand-tuned, so the same movement could rest 45s in one routine and 90s in
  another with nothing on screen saying why — and the seeded program shipped
  five different values. It is one number now, read through
  `currentRestSeconds()`, which every consumer goes through: the manual start,
  the auto-rest after a set, the reset button, and the tag in the exercise
  head. A rest length changed in Settings reaches an idle session timer
  immediately and a running or paused one on its next rest, because cutting a
  rest already under way is not what editing a preference should mean.
- **`rpe` and `rir` are independent fields on a set, but only one shows as an
  input at a time.** `settings.effortMetric` (`'none' | 'rpe' | 'rir'`) is the
  global default. A routine item's optional `targetRir` overrides that default
  for its exercise so the prescribed value can be logged. Both fields still round-trip
  through import/export and history editing regardless of the current
  setting, so switching the setting later doesn't lose whichever one a set
  already carries; only the active-workout input for the *other* one is
  hidden while it's not selected. The history editor's third field follows the
  same setting, falling back to whichever of the two the set actually carries
  when effort tracking is off — a logged value nobody can reach to edit is
  worse than a column that changes caption. The sample data (both the seeded
  first-run history and the sample history file Settings hands out) logs
  **RIR**: it is the figure a lifter can answer honestly straight after a set.
- **Everything crossing the boundary is validated.** `normalizeState()` and the
  `normalizeImported*()` functions clamp units, themes, numbers and free text on
  the way in, so the render layer never has to defend against stray strings.
  All interpolated values are escaped with `esc()`.

### Schema migrations

`prepareBackup()` validates and clones candidates, then runs migrations in
sequence for older data. Startup and file/remote restore all use it:

- **v1 → v2** — refreshes the seed exercise library and routines to the
  current sample data, keeps logged workouts and preferences.
- **v2 → v3** — moves seconds out of `reps` into `durationSeconds`; adds the
  `countForVolume` / `countForPR` split.
- **v3 → v4** — adds `settings.effortMetric`, preselecting RPE where a logged
  RPE already exists.
- **v4 → v5** — adds `exercises[].url`, the how-to link. Nothing to convert; the
  version moves so a v5 file is never handed back to a v4 build, which would
  drop the links on its next save.
- **v5 → v6** — removes `items[].rest` and `exercises[].restSeconds`. One-way:
  hand-tuned rest lengths survive only in a backup taken before the upgrade.
- **v6 → v7** — introduces the optional `eitherOf` key; no conversion needed.
- **v7 → v8** — replaces single `reps` / `targetReps` values with equal lower
  and upper bounds. New routines can then widen the range and add `targetRir`.
- **v8 → v9** — adds reversible historical exercise links and explicit
  keep-separate decisions. Existing history needs no conversion.
- **v9 → v10** — adds the dated bodyweight log and distinct added-load fields
  for bodyweight sets. Any older bodyweight set carrying `weight` moves that
  value to `addedWeight`; unsupported distance fields are removed.
- **v10 → v11** — adds archive state, load convention, equipment identity, and
  movement family to library definitions and workout snapshots; legacy library
  categories are mapped into the broad category vocabulary while finished
  workout category snapshots remain unchanged.
- **v11 → v12** — adds per-series load cue preferences. The migration starts
  with no disabled or dismissed cues; full backups and history transfers carry
  the new field.
- **v12 → v13** — introduces the optional `supersetOf` key; no conversion needed.

Data that cannot be read — corrupt JSON, an unrecognized shape, or a *newer*
schema version — is never overwritten in place. It is copied to
`localStorage['liftlog.v1.unreadable']` and the app starts from seed with a
warning. Settings offers the untouched bytes as a download and requires a
separate confirmation to discard them. If that copy cannot be saved, or would replace a different recovery
copy, the original key is left intact and automatic writes are blocked. The
save banner and startup message explain this state; explicitly restoring a
  valid backup re-enables writes.

## Import / export

Four flows, all plain JSON (`EXPORT_SCHEMA = '1.10.0'`). Every file names itself
with `app: 'liftlog'` and a `kind`:

- **`backup`** — the entire `state`; importing replaces everything. Built by
  `backupPayload()`, which is also what the remote PUT uploads, so the file in
  your downloads folder and the object in your bucket are the same thing. It is
  a deep copy of the whole of `state`, so **every** setting travels with it
  (theme, unit, default rest, auto-rest, sound, vibration, effort metric, and the backup
  stamps) and a restore puts them all back. The one deliberate exception is the
  remote-storage config: it lives under its own `localStorage` key and stays on
  the device, so a backup file — including the copy sitting in the bucket —
  never carries bucket credentials. `prepareBackup()` removes the transfer
  envelope (`app`, `kind`, `schemaVersion`, `source`, `exportedAt`) before the
  candidate becomes live state, and `backupPayload()` writes a fresh envelope
  last so restored metadata cannot leak into a later export.
- **`routines`** — routines plus the exercise definitions they reference, so an
  import into another browser can rebuild missing library entries. Exercises are
  resolved by id, then by name, then created. Safe source exercise, routine, and
  item IDs are preserved so a separately transferred history file still lines up.
  Duplicate routine names are skipped.
- **`history`** — workouts, with an explicit `setType` (`reps` / `time` / `hold`)
  on every set so importers never guess at field semantics. Explicit `setType`
  wins over a contradictory unit; unsupported types such as the former
  half-implemented `distance` set are dropped rather than stored without an
  editor. History files also carry the dated bodyweight log so bodyweight
  analytics survive transfer.
  Deduplicated by workout id; first write wins. Identical IDs are reported as
  already present, malformed workouts as invalid, and different content under
  an existing ID as a conflict. History files also carry relevant
  `exerciseLinks`, `historySeparateIds`, and relevant `progressionPreferences`;
  local cue preferences win when the same series has a setting already. Links are restored only when their
  current Library target exists and has the same measurement, load convention,
  and equipment identity.
- **`remote-config`** — the remote-storage settings, optionally without the
  secret key. See [Remote storage](#remote-storage-optional).

`kind` exists because a routines file and a backup are not distinguishable by
shape: both carry a `version` and an `exercises` array, so the full-backup
importer used to accept a routines file and "restore" a state with no history
and default settings. `applyFullBackup()` now turns away anything that names
itself as another kind. Files predating the marker have no `kind` and are still
accepted on shape alone.

Legacy files without `setType` fall back to the exercise/set unit, and
`includeInVolume` is accepted as an alias of `countForVolume`. In schema 1.7,
bodyweight sets use `addedWeight` and `addedWeightUnit`; older bodyweight sets
with a `weight` value are normalized into those fields.

### The format is documented in the app

Settings → **Transfer routines & history** has a **?** that opens the field
reference for both file kinds, and buttons that download a working sample of
each. Three things have to agree on that shape — the export, the sample, and
the reference — so there is exactly one builder per kind
(`routinesPayload()`, `historyPayload()`) and exactly one piece of example data
(`importFixture()`). The reference renders its examples by putting that fixture
through those builders, which means:

- the samples are guaranteed to import, unlike a hand-written snippet in a doc;
- what the dialog shows is byte-identical to what the buttons download and to
  what a real export writes;
- the bounds quoted in the reference are interpolated from `ITEM_LIMITS` and
  `UNITS`, the constants the importer actually clamps against, so they cannot
  drift from what is enforced; the set-type list comes from `SET_TYPES`, which
  `historyPayload()` also writes from. (`normalizeImportedSet()` still branches
  on each type individually — each one decides a different field — so a new
  type needs teaching there too.)

The fixture deliberately covers the three cases a reader would otherwise get
wrong: a warm-up set (`countForVolume: false`, still `completed`), timed work
(seconds in `durationSeconds`, `reps: null`), and a routine item referencing an
exercise the importing browser may not have.

There is no "load sample data" button. It would silently replace the user's
own library and routines, which is not a thing an app should offer to do;
importing a file you chose is the same convenience without the surprise.

## Remote storage (optional)

Local storage is still the only place data lives by default. Settings →
**Remote storage** lets you additionally back up to, and restore from, a
bucket you configure yourself. It is off until you fill in the form (or load a
config file); nothing changes about local-first behaviour if you never touch
it.

### Why S3, not WebDAV

The app has no server, so any remote protocol has to be one the *browser* can
call directly — there is nothing to proxy the request through. That rules out
protocols where the browser's own CORS enforcement is the practical blocker:

- **WebDAV** servers (Apache `mod_dav`, Nextcloud, ownCloud, …) mostly assume a
  same-origin client (a desktop sync client, a mounted drive) and inconsistently
  send `Access-Control-Allow-*` headers on `PUT`/`PROPFIND`. A browser-only
  client would work against some installs and silently fail CORS preflight
  against others, with little the app can do about it.
- **S3's REST API**, by contrast, treats direct browser access as a first-class
  case — bucket CORS configuration is a standard, documented feature that
  exists specifically so browsers can upload/download directly. It's also a
  de facto standard: AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi and
  DigitalOcean Spaces (among others) all speak it, so "S3-compatible" covers
  both managed and self-hosted options rather than locking in one vendor.
- A vendor API with OAuth (Dropbox, Google Drive) would also work CORS-wise,
  but needs app registration, a redirect flow and per-provider code — a much
  larger surface for a single-file, dependency-free app, and it ties the
  feature to one vendor.

So the app implements a minimal **AWS Signature V4** signer for plain
`PUT`/`GET` object requests, using only the browser's native Web Crypto API
(`crypto.subtle` — SHA-256 and HMAC). No SDK, no dependency.

### Setting it up

In Settings → Remote storage, fill in:

| Field | Meaning |
| --- | --- |
| Endpoint URL | Your provider's S3 endpoint, e.g. `https://s3.us-east-1.amazonaws.com`, `https://<account id>.r2.cloudflarestorage.com`, or your own MinIO URL. `http://` is accepted too, for a LAN or self-hosted server (e.g. `http://srv-usio:3902`) — but only works if this app itself was opened over `http://`, `file://`, or localhost, since browsers block a page loaded over `https://` from calling an insecure endpoint. |
| Region | e.g. `us-east-1`. Cloudflare R2 uses `auto`. |
| Bucket | The bucket to back up into. |
| Object key / path | Where the backup is stored inside the bucket. Defaults to `liftlog-backup.json`. |
| Access key ID / Secret access key | Credentials for that bucket. Scope them to just this bucket, and to just `GetObject`/`PutObject`, if your provider supports it. |
| Path-style addressing | Turn on for MinIO and most self-hosted endpoints; leave off for AWS S3, R2, B2 and Spaces. |

### The config file

The form is not the only way in or out. **Load config file** reads a JSON file
with the same fields (`endpoint`, `region`, `bucket`, `accessKeyId`,
`secretAccessKey`, `objectKey`, `pathStyle`), and **Save config file** writes
one — so setting up a second device does not mean retyping the form or
hand-writing JSON to feed the loader.

`secretAccessKey` is optional in both directions, which is the point:

- **Without the secret** (the offered default) the file is not a credential. It
  carries everything else, and the receiving device fills the form from it and
  waits for the secret to be pasted in.
- **With the secret** the file is a complete credential for that bucket: anyone
  who opens it, and anywhere it gets synced or mailed, can read and write there.
  It is behind its own button in the download dialog for that reason.

Either way a loaded file lands in `ui.remoteDraft` — the same draft the form
edits — so it is reviewable before it is anything else, and it reaches storage
only through the connection test below. A file is no more trustworthy than a
typed form.

**Save configuration** tests the connection before writing anything to
storage: it sends a signed `GET` against the config you just typed and only
persists it once that request comes back ok (a 404 still counts — it just
means nothing has been backed up there yet). A failing request reports why
and leaves the form open with what you typed untouched, rather than saving
credentials that don't work. Typed-but-unsaved fields are also kept in memory
across re-renders, so switching another setting (theme, unit, …) while the
form is open no longer clears it.

Once configured, state changes are backed up automatically after a short
debounce. On launch the app reads the remote object and compares
`settings.lastModifiedAt`; a newer remote snapshot is restored, while a newer
local state is uploaded. The local state replaced by an automatic restore is
kept under `liftlog.v1.before-remote-restore` until the user downloads,
restores, or discards it. **Backup now** and the confirming **Restore from
remote** remain available as explicit controls. This is single-writer,
whole-state synchronization: it deliberately does not merge concurrent edits.

### Bucket CORS policy

The bucket needs to allow this app's origin to call it directly. Example (AWS
S3 CORS configuration):

```json
[
  {
    "AllowedOrigins": ["https://your-liftlog-host.example"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]
```

If the app is opened from `file://` or a variety of hosts, use `"*"` for
`AllowedOrigins` instead — but note that widens who can call the bucket
(assuming they also have valid credentials), so prefer naming an origin when
you can.

### Limits, honestly

- **Credentials sit in `localStorage` in plain text.** There is no server-side
  vault to put them in; that's the trade-off of a server-less app. Anyone with
  access to this browser profile can read them. Use a bucket/credentials you
  are comfortable with at that exposure level, and scope the access key as
  narrowly as your provider allows.
- **Requires a secure context.** `crypto.subtle` (used for request signing) is
  only available under `https://` or `localhost`. Remote storage disables
  itself with an explanatory message otherwise (e.g. plain `file://` in some
  browsers).
- **Single writer.** Automatic backup and startup restore compare whole-state
  timestamps. They do not merge concurrent edits from multiple devices.

### Links out

`exercises[].url` is the only value in the app that becomes an `href`, and the
only thing that sends you anywhere off the page. Two rules hold it:

- **`safeUrl()` is the single gate.** `esc()` cannot help here — `javascript:`
  contains nothing escapable and would survive escaping intact — so every path
  that can set a URL (both forms, `normalizeState()`, the routines importer)
  runs it through `safeUrl()`, which keeps `http:` and `https:` and returns `''`
  for everything else. `''` reads as "no link" everywhere, so a rejected URL
  costs the link, never the exercise. A hostname is also required to look like
  one: `new URL()` will percent-encode a typed sentence into a host, and that
  should not pass as a link.
- **It opens in its own tab, with `rel="noopener noreferrer"`.** A session is
  never navigated away from, and the page that opens cannot reach back.

This does not break "no network calls at all" — the app still fetches nothing —
but clicking the link is a visit to a third party, which is worth knowing.

## Progress metrics

The History screen reads the same log two ways, switched by the Exercise /
Movement family tabs in the Progress panel.

**Per exercise** — `trendPanel()`. One movement over time, judged by
`exMetric()`: estimated 1RM for loaded work, longest hold for `time`, and
estimated total 1RM for bodyweight work once a dated bodyweight is available
(otherwise best set in reps). Both modes call `exMetric()` and `exSessions()`, so the chart
and the breakdown list can never disagree about what "better" means.

**Records** — `sessionRecords()` / `recordsHTML()`, under the per-exercise
trend. A session that beats every earlier session on the same `exMetric()` is a
record; the first session is the baseline, and a tie is not a gain. Records are
the filled dots on the line and a newest-first list with the gain each one
made, because "when did this last get better" is the question a plateau asks
and a first-to-last delta does not answer it.

**Weekly** — `weeklyChart()`, switched between **volume** (weight × reps) and
**working sets** (`countsVolume()`, every movement). Volume is honest for a
barbell program and not for a machine one, where stacks on different machines
are not the same kilogram; working sets count the same on anything. Both show
the last four weeks, this one included, against the four before.

**Per movement family** — `musclePanel()`. Every movement carrying the same
`movementFamily`, charted as **working sets per week** — a completed set that is not
a warm-up, i.e. `countsVolume()`.

**Double-progression flag** — `progressionStatus()`. History compares completed
working sets for each exercise across logged sessions. The first prescribed
number of sets must have reps and one common working load; incomplete or
mixed-load prescriptions restart the comparison. A session without completed
working sets is not an exposure. At the same load, a larger total rep count
across those sets is a gain; a higher load is a gain even if reps drop. A lower
load (such as a deload) starts a new comparison window. After a baseline and three consecutive
comparable sessions without either gain, History shows a progression flag with
the latest set-by-set reps. Kilograms and pounds are converted before comparing;
bodyweight exercises compare total bodyweight plus added load when known, and
otherwise compare reps plus any added load. Timed work is excluded. The flag is derived
from history on render, so history edits and imports update it without a new
stored field or schema version.

The same latest-exposure calculation produces load guidance in Today for
exercises in the selected routine and in the active workout. It checks the
current routine or workout prescription: every prescribed working set must
reach its upper rep target, and a target RIR must be met when set. Without a
prescribed RIR, the cue says **Rep target met** and asks for a technique/RIR
check before adding load. With one, it says **Ready to increase load** while
still requiring a technique check. A ready exposure suppresses a stall flag
for that series. History keeps stall warnings before the charts while putting
historical load results and their settings behind a disclosure. Workout rows
can be searched by exercise name, and **View last session** opens and focuses
the exact workout block behind a result.

`progressionPreferences[]` keys a load-suggestion setting to the canonical
progression ID. A dismissal hashes the latest workout block and expires when
the next exposure is logged or that result is edited. Turning suggestions off
persists until turned back on in History's progression analysis. The manager
also includes historical IDs with no Library definition; linking or merging a
series carries its preference to the surviving ID.

Sets, not tonnage, and deliberately so. Load is a property of the machine, not
of the muscle: a dip on an outdoor bar, a plate-loaded press and a cable fly all
train the chest at numbers that cannot be summed or compared. Bodyweight work
uses the dated bodyweight log for its own volume, while a completed working set is the
one unit that means the same thing on all of them. Load progression is not
thrown away, it just stays where it is honest: per movement, in the breakdown
list below the chart, each with its own metric and its own first-to-latest
delta. Reading them side by side is how an outdoor session and a machine
session get compared without pretending their numbers are interchangeable.

`weekBuckets()` / `weekBarsSVG()` are shared with `weeklyChart()`, so tonnage
per week and sets per week bucket and draw identically.

## Theming and the system bar

`THEMES` is the closed vocabulary; `THEME_SCHEME` says whether each entry is
light or dark furniture, with `system` mapped to `null` so it defers to
`prefers-color-scheme`. `applyTheme()` sets both halves of the platform
contract, and both are required:

- `document.documentElement.style.colorScheme` — the colour of everything the
  app does not paint: Android status-bar glyphs, the gesture pill, form
  controls, scrollbars. Without it the platform assumes any page is light,
  keeps dark glyphs, and a dark theme loses its system bar.
- `syncSystemBar()` — the fill behind them, read from the active theme's
  computed `--surface`. `--surface`, not `--bg`, because `.app-header` is what
  paints the strip the status bar sits in (see **Safe areas** above).

### The glyphs are not ours

Neither lever above actually moves Android's status-bar glyphs in an installed
PWA. On Android 15 a WebAPK is drawn edge-to-edge: the status bar is
transparent, the clock and status icons land directly on the app's own pixels,
and their colour follows the **phone's** light/dark setting. Not `theme-color`,
not `color-scheme`, not the manifest. The page does not get a vote.

Which is fine while the two agree, and invisible when they do not:

| Phone | Theme | Glyphs | Strip, before | |
| --- | --- | --- | --- | --- |
| dark | Light pinned | white | white | gone |
| light | Dark pinned | dark | dark | gone |
| dark | Dark / System | white | dark | fine |
| light | Light / System | dark | white | fine |

So the glyph colour is taken as a given and the strip is matched to it instead.
When the active theme's scheme disagrees with the system's, `syncSystemBar()`
sets `data-statusbar="invert"` on the root and `.app-header::before` fills the
inset with `var(--text)`.

`--text` is the right token by construction rather than by luck: it is the
colour that reads against this theme's background, and in the mismatched case
the system's glyphs are drawn for a background of exactly the opposite
brightness to that one. The `theme-color` meta is set to the same value, so
anywhere the bar *is* tinted from it the two agree instead of fighting. All
sixteen theme × system-mode combinations clear 4.5:1 against the glyphs; the
worst is 11.1:1.

The rule is inert where it should be: the pseudo-element's height is the inset
itself, which is `0` wherever there is no status bar to cover.

### What Chrome actually uses, on this phone

Measured on a real installed app (Android, `display-mode: standalone`, phone in
dark mode, Dark theme active) via the diagnostics block below:

```
Top safe-area inset: 0px
Display mode: standalone
theme-color (page): #1d2024      <- dark, correct, and ignored
theme_color (manifest): #fbfbf9  <- near-white, and what the bar used
```

Two conclusions, both load-bearing:

1. **The inset is `0`, so the app is not drawn under the status bar.** Chrome
   paints an opaque bar itself. The padding and the scrim above are correct but
   inert in this configuration — they engage only once a WebAPK goes
   edge-to-edge, which is where Chrome is heading, not where it is here.
2. **Chrome takes the bar's colour from the manifest, not from the page.** The
   page was sending `#1d2024` under every theme and the bar stayed white.
   `theme_color` is baked into the WebAPK at install time.

And a third, by elimination: **Chrome does not set the glyph polarity from
`theme_color` either.** Had it done so, a near-white bar would have been given
dark glyphs and stayed legible. It did not — the glyphs follow the *phone's*
dark-mode setting. That is the constraint the value has to be chosen against.

### Why the value is dark

Three colours have been tried. What settled it was not a measurement here but
one sentence from the device: **every other app shows a black status bar with
legible icons; only this app turns it white.**

That says the glyphs are light, uniformly, and it says so without needing to
guess: a black bar with readable icons is only possible if the icons are light.
So a dark bar is correct and `theme_color` is `#1d2024`, which is also the dark
theme's `--surface`, so the bar reads as continuous with the header.

| `theme_color` | vs the light glyphs One UI draws |
| --- | --- |
| `#fbfbf9` | **1.04:1** |
| `#6d777f` | 4.57:1 |
| `#1d2024` | **16.35:1** |

`#6d777f` came from reading "only the battery percentage is visible" as proof
that the glyphs were of mixed colours, since no single colour could hide some
and not others. The simpler explanation is the right one: One UI draws that
number with an outline and the icons as flat fills, so on a white bar the
outlined text survives and the fills do not. One inference too many, on one
detail, against the plainer reading.

### The value has to reach the installed app

This is the part that made the last two rounds inconclusive, and it is worth
stating plainly: **`theme_color` is baked into the WebAPK at install time.**
Changing the file changes nothing on a phone that already has the app. Chrome
re-reads the manifest on its own schedule and updates the installed app in the
background, which can take a day or more; `chrome://webapks` forces it, and
uninstalling and re-adding is certain.

Two caches sit in front of that, and the diagnostics block reports both:

| served | network | means |
| --- | --- | --- |
| differs from network | — | the shell cache is stale |
| matches network | matches source | the installed app is stale, or fixed |

The page cannot read the colour the installed app was built with — nothing in
the platform exposes it — so "served matches network" plus a wrong bar is the
signature of a stale install, and that is as close as this can get.

`manifest.webmanifest` is therefore **network-first** in `sw.js`, unlike every
other sub-resource. Serving it from cache does not cost a stale pixel; it pins
the installed app to whatever it was built with. It is a few hundred bytes and
falls back to the cache offline. Twice the `CACHE` bump was the thing that made
a colour change real, which is a bad thing to have to remember.

One caveat on the diagnostics block below: its manifest row reports the value
in the *file*. An installed app keeps the colour it was installed with until it
is reinstalled, and nothing the page can reach reports that one — so the row
agreeing with the source is not evidence the installed app agrees.

Changing `theme_color` requires bumping `CACHE` in `sw.js`: shell files other
than the document are served cache-first and never revalidated, so Chrome would
otherwise keep reading the old manifest out of the cache indefinitely.

### Diagnosing it on a real device

None of the above is observable from here: a headless browser can be told to
report a top inset, but it cannot tell you what Chrome does with a WebAPK on
someone's phone. So Settings → Appearance carries a collapsed **System bar
diagnostics** block (`systemBarReport()`), listing every value the page can
see — resolved `env(safe-area-inset-top)`, display mode, the phone's dark-mode
setting, the active theme and its scheme, the invert flag, the live
`theme-color`, the manifest's `theme_color`, and the two tokens involved.

The top inset is the one to read first: **it is what scales everything the app
does about the system bar.** At `0` the app is not being drawn under the status
bar at all, the bar belongs entirely to Chrome, and neither the padding nor the
scrim is in play — whatever is wrong is then not something this page can reach.

`paintDiagnostics()` refreshes the list in place from `syncSystemBar()` rather
than re-rendering the view, because `setTheme()` repaints the tokens without
re-rendering Settings. Reading the values theme by theme is the point of the
block, and a stale readout would be worse than none — it would look like
changing the theme had changed nothing.

Because the flag depends on the *system* scheme under every theme — not just
`system` — the `prefers-color-scheme` listener re-runs `syncSystemBar()`
unconditionally. Under a pinned theme an OS switch changes nothing on the page
and still flips which colour the strip has to be.

Set only one and a dark theme gets white glyphs on a white bar, or dark glyphs
on a dark bar.

`syncSystemBar()` drops the media-scoped pair from `<head>` on its first call
and only then. That pair can express only "system light" and "system dark", and
a browser uses the first meta whose media query matches, so leaving them in
place would keep them winning over the six custom themes. They stay in the
document as the first-paint fallback before scripting runs, and are removed
once there is something better to say.

From then on the same element is **mutated**, not removed and re-added. A
browser holds a reference to the theme-color element it picked; swapping the
node out on every theme change is the fragile way to tell it the colour moved.

The manifest's `theme_color` is a single static value and cannot follow a
theme — an installed PWA opens with it, then `applyTheme()` corrects the bar on
the first frame. A `prefers-color-scheme` listener re-runs `syncSystemBar()` on
an OS switch, but only while the theme is `system`; a pinned theme ignores it.

## Conventions

- **Styling goes in the stylesheet.** Templates use classes (including the small
  layout utilities `.mt-*`, `.mb-*`, `.flex-*`, `.divider-top`, …). The only
  inline styles left are genuinely computed values: the rest timer's drain
  width and the session strip's per-exercise segment weights and fills.
- **One timer, one set of ids.** `drawTimer()` and `paintTimerTime()` look up
  `#timer-panel`, `#timer-time`, `#timer-fill` and `#timer-toggle` singly, so
  exactly one copy of the action bar may be in the document. Two would leave
  the second silently unpainted.
- **Closed vocabularies live in `DOMAIN CONSTANTS`.** Units, themes, rest bounds,
  routine-item bounds, set types and the shortcut list each have exactly one
  definition, and the templates, validators and importers all read from it. The
  keyboard help dialog and the Settings shortcut table are both rendered from
  `SHORTCUTS`; the import-format reference reads `ITEM_LIMITS`, `UNITS` and
  `SET_TYPES`.
- **A `<dialog>` that sets `display` must scope it to `[open]`.** An unqualified
  `display:flex` on a dialog outranks the UA sheet's
  `dialog:not([open]){display:none}`, leaving a closed dialog laid out on top of
  the page and swallowing clicks. See `.dlg-wide[open]` and `.dlg-sheet[open]`.
- **A dialog the app opens must be told when the user closes it.** Esc and a
  click on the scrim close a `<dialog>` without going through an action, so
  both sheets listen for `close` (`wireSheet()`) and write `ui.overviewOpen` or
  `ui.detail` back — guarded, so the `close()` a render just issued does not
  start another render. The event is queued, not synchronous: a test that
  presses Esc has to wait for it to land.
  Anything gating on "is a dialog open" should ask the document
  (`document.querySelector('dialog[open]')`) rather than naming two of them and
  silently missing the third, which is what the shortcut guard used to do.
- **Escape everything interpolated** with `esc()`. `setSummary()` returns escaped
  HTML because unit strings can originate in an import file.
- **Feedback has one channel per message.** `#toast-region` is `aria-live`, so a
  toast is already announced; `announce()` is only for feedback that has no
  visible toast. Do not pair them.

## Typography

One family, sans-serif throughout, differentiated by size, weight and tracking
rather than by a second face. Every family named in `--font-ui` and
`--font-mono` is open-source (SIL OFL or Apache-2.0), ordered by how likely it
is to be installed already — Roboto and Noto cover Android, Inter and Source
Sans most Linux desktops, Liberation and DejaVu the rest. Liberation comes
before DejaVu for width rather than likelihood: it has Arial's metrics, close to
the Roboto and Helvetica the layout is drawn against, while DejaVu is wide
enough to overflow the five header tabs at 320px — which is also what a bare
Linux CI runner falls back to.

**No webfont is fetched, so nothing is guaranteed.** The app makes no network
calls and ships as one document, which rules out both a `@font-face` URL and a
separate font file; the stacks are a preference list, and on a machine with
none of those families installed the generic `sans-serif` / `monospace`
keywords decide, which may well land on a proprietary face. Genuinely
guaranteeing an open-source face means embedding a subset as a `data:` URI —
see [ENHANCEMENTS.md](ENHANCEMENTS.md) for what that costs.

`--font-mono` is kept for the rest countdown and tabular figures, where
consistent digit widths stop the numbers jittering as they change. Its families
are sans-serif designs too.

## Accessibility

Keyboard shortcuts (`?` for the full list) are disabled while typing. Live
regions announce set completion, rest completion and workout restore. The rest
timer uses `<output>`, dialogs are native `<dialog>`, and
`prefers-reduced-motion` disables animation. Themes are token-driven, so a new
theme is one `:root[data-theme="…"]` block plus an entry in `THEMES`.

**The end of a rest is signalled three ways, and no one of them is required.**
`announce()` puts it in the live region, the drain bar and clock turn green,
and `ALARM` sounds. Vibration is a fourth where the browser has it. Sound and
vibration each have their own switch in Settings and each can be off; the
announcement and the colour cannot, which is what keeps a deaf user, a muted
phone and a screen reader all served by the same transition.

**No gesture is the only way in.** The long press that marks a warm-up
(`data-longpress` on the done cell) has no keyboard equivalent, so the set
number stays an ordinary button with the same toggle on it. A drag handle has
no keyboard equivalent either, so it answers the arrow keys itself and keeps
the up/down buttons beside it. Anything reachable only by holding a finger down
is a bug.

## Testing

Two Playwright suites exercise the real document on an isolated synthetic
origin: `tests/regression.cjs` for workflows, migrations, transfer round trips,
progression and mobile layouts, and `tests/security.cjs` for backup
validation, hostile imported values and recovery behavior. `npm ci` then
`npm test` runs both; [tests/README.md](tests/README.md) has the details.
GitHub Actions runs them on every pull request and on `main`, inside
Playwright's own image so that the browser *and the fonts* are fixed — the
layout checks at phone widths depend on text metrics. The image tag is read
from `package.json`, and Dependabot keeps that version current.

They reach the app's internals through one marker line, `/* @test-seam */`,
before `init();` at the end of the script: `tests/harness.cjs` replaces it in
the copy it serves with a `window.testAPI` object built inside the closure.
Keep that line as it is. The harness refuses to start without it, rather than
every check failing later on an undefined handle.

If touching remote storage, also test a failed connection and a backup/restore
round trip against a real S3-compatible bucket; the local suites stub that
boundary.

Also exercise the set row: log a set from its own box in the done column (and
check auto-rest starts), mark a set as a warm-up both by long-pressing that box
and from the set number, confirm the session volume does not move when a warm-up
is completed, and reclassify a logged set in the history editor. The long press
needs its edges checked: a press that turns into a scroll must not mark
anything, the tap that ends the press must not also log the set, and a plain tap
straight afterwards must. Warm-up marking has two entry points because the
set-number cell is dropped below 360px when an effort column is on — worth
checking at 320px too.

The Exercises screen and session picker list movements A–Z using the same
case-insensitive, numeric-aware comparison. The picker also leaves out what is
already in the session and refuses a duplicate even if a stale value is
submitted. Sorting is applied to the rendered copy; stored order and ID
references are unchanged.

The session sheet needs its modal edges checked: Esc, the scrim, the X and
"Back to workout" all close it and return focus to the strip button; a reorder
or an add refills it without it blinking shut; keyboard shortcuts do not fire
behind it; discarding raises the confirm dialog *over* it and closes both; and
on a phone the page behind must not scroll.

The detail sheet needs the same edges, once per kind: open a routine, an
exercise and a session by tapping anywhere on the row (beside a routine's Start
too, which must start rather than open); close each by the X, Esc, the scrim
and — on Android — the back gesture, and check focus lands on the row it came
from. Deleting from a sheet raises the confirm over it and closes both.
Archive an exercise from its sheet and check the toast is readable above it;
then Edit it with archived exercises hidden, which must still find its row.
Finish a workout and check its sheet opens as the summary, with the backup
reminder, when due, above it.

Dragging a row is worth its own pass, by finger as well as by mouse. A drag
that starts anywhere but the grip must scroll the sheet instead. A drag that
ends where it began, one cancelled by the system, and one interrupted by Esc
must all leave the order untouched and no row stuck mid-air. A flick past
several rows at once must land where it looks like it landed. And the case the
index arithmetic exists for: finish an exercise, jump ahead and finish another,
jump back — the finished one now sits among the exercises still to come, and
dragging a row past it must step over it without moving it.

The current exercise drags like any other, and that needs its own pass. Its up
arrow is always disabled (it is the lowest movable position) and it has no
*Start now*. Moving it later must hand *Now* to whatever lands in its place,
change the exercise on the screen behind the sheet, and announce it. Do it with
sets already logged against the moved exercise and check they travel with it.
The single-movable-exercise case is worth one look too: both arrows disabled, a
drag that does nothing, and no error from pressing either.

Session movement is worth walking end to end from the strip's pager: `‹` is
disabled on the first exercise, steps back into a skipped one (un-skipping it),
and still works from the end-of-session state, where `›` is disabled instead;
<kbd>p</kbd> and <kbd>n</kbd> do the same. On the last exercise `›` carries the
finish icon and reads *Wrap up*. Both arrows must land on the same pixels for
every exercise in the routine, whatever its set count, and at every scroll
position — that is what they are up there for, and the same test applies to the
action bar's bottom edge.

Storage durability is testable without four browsers: stub `navigator.storage`
and `navigator.permissions` before the page scripts run and check Settings
reports the right one of the four states, that a refused `persist()` removes the
request button rather than leaving one that cannot work, and that a rejected
promise never leaves "Checking…" on screen.

For the storage and install paths specifically:

- **A finished rest survives a reload.** Let a rest run out, reload, and check
  it reads `0:00` / "Rest complete" rather than resetting to a full timer.
- **The save banner appears and clears.** Stub `localStorage.setItem` to throw
  from the console, log a set (banner appears, download works), restore it, log
  another (banner clears).
- **Backup staleness.** Set `settings.lastFileBackupAt` back three weeks, finish
  a workout, and check both the toast and the red line in Settings; exporting
  clears both.
- **Offline and installable.** Serve the folder over `http://localhost`, load
  once, then reload with the network off — the app must still open. Check the
  service worker reaches *activated* and the manifest parses with no console
  errors.
- **`file://` still works.** Open the file directly and start a workout: no
  service worker, no console errors, everything else unchanged.
- **An update while the app is already open surfaces itself.** Load the app,
  edit `index.html` (a plain content change, not `sw.js`), and reload twice —
  the first reload still shows the old page but a toast should say an update
  is ready; the second shows the new one. Separately, editing `sw.js` itself
  (e.g. bumping `CACHE`) should produce the same toast via the older
  `updatefound`/`SKIP_WAITING` path — the two are independent signals for the
  same message, and a release can trip either one.

### Either-of routine pairs (state v7, transfer schema 1.4.0)

Two items can share an optional `eitherOf` string key, scoped to their routine.
They must reference different exercises. The editor has one **Pair exercises**
button, which opens a picker of unpaired exercises already in that routine.
Existing pairs are listed there with **Unpair** controls. Deleting one item also
dissolves its pair. Targets remain on each item; reordering and duplication
preserve the pair. Pairing moves the two items next to each other. A violet
bracket with one **OR** pill between the rows marks the choice without using
green, which supersets use. The session overview uses the same
marker while both alternatives remain; if they are separated by reordering,
each keeps an inline **OR** cue. Dragging or using the arrow buttons moves the
pair as a unit in the routine editor.

Starting a routine includes both alternatives as adjacent workout blocks. Once
all sets of either block are completed, its partner is removed from that active
workout only; the saved routine keeps both. Planned-set progress counts the pair
once until it is settled. Routine summaries count pairs once and show a set-count
range if targets differ.

`cleanRoutinePairs` removes singleton, oversized, and same-exercise pair keys
on load, import, and save. Routine export and backup retain keys. The sample
routines JSON demonstrates Back Squat or Leg Press followed by Plank, and the
seeded first-run library pairs Leg Press Machine or Leg Extension Machine in
its Lower Body routine, so a fresh install shows the feature without a trip to
the editor. Old state migrates through the shared `migrateState` chain; v6 to
v7 only advances the version because the new field is optional.

### Supersets (state v13, transfer schema 1.11.0)

Supersets reuse the either-of pair machinery with a second key. Two routine
items can share an optional `supersetOf` string; the same rules apply (exactly
two items, different exercises, routine-scoped). An item belongs to at most one
pair: `cleanRoutinePairs` keeps `eitherOf` and drops `supersetOf` when an item
carries both. `routineGroups` groups by a kind-prefixed key (`pairKeyOf`), so
adjacency, reordering, duplication and the arrow buttons treat both kinds
alike. Only counting differs: an either-of pair plans its larger alternative,
a superset plans both members (`groupPlannedSets`, `routineSummary`). The
editor's **Superset…** button opens the same dialog as **Pair exercises…**,
reworded through `PAIR_KINDS`. The marker is the either-of bracket in green
(`--superset`, derived from each theme's `--success`) with a **+** pill.

**The group cursor.** `currentExerciseIndex` always names the first block of a
superset, and `activeWorkout.supersetSide` selects the member on screen, so
`isSettledRow`'s "before the cursor is settled" rule holds without change.
`currentExercise()` resolves the member; `pointAt()` is the one way to move
the cursor onto a block. A superset in a workout is a run of adjacent blocks
(`supersetRun`); `settleSupersets` ends any superset whose members were
separated or orphaned by a reorder or removal, for that session only, with a
toast.

The seeded first-run library demonstrates a superset too: Bicep Curl Machine
and Triceps Extension Machine in the Upper Body routine, the standard
antagonist-pair combination.

Logging a set asks `supersetTurn` for the next member with work left. A
hand-over to a later member does not rest; wrapping back to the first member
(or staying because the partner is finished) ends the round and starts the
auto-rest. Unequal set counts therefore finish as straight sets. Once every
member is finished the cursor moves past the whole run, and the pager's `›`
and **Next** also step a superset at a time. The panel's **Superset with**
button switches member by hand. Skipping a member hands over to its partner.

Supersets describe how a session is performed, not what was logged:
`finishWorkout` strips `supersetOf` and `supersetSide`, and normalization
removes them from any finished workout. History and history transfers never
carry them; routine export, routine import and full backups (including an
active workout) do.

### Double-progression targets (state v8, transfer schema 1.5.0)

Routine items store `repsMin`, `repsMax`, and an optional `targetRir`. Starting
a workout copies those values to `targetRepsMin`, `targetRepsMax`, and
`targetRir` on the workout-local exercise block. Set inputs start at the lower
bound; Today displays the full range, and a prescribed RIR makes the RIR input
visible for that exercise even when global effort tracking is off.

The v7 to v8 migration maps the former `reps` and `targetReps` values to equal
lower and upper bounds, preserving old prescriptions exactly. Routine and
history importers continue to accept those legacy names. The downloadable
samples and field reference use only the canonical v8 names.

### Historical exercise reconciliation (introduced in state v9, transfer schema 1.6.0)

Workout exercise blocks remain snapshots of what was logged. History derives a
catalog from those snapshots, which means Progress and muscle-group analytics
work even when an exercise ID is absent from the current Library. A saved
`exerciseLinks` entry maps an old source ID to a current Library target for
analytics; it never rewrites workout names or IDs. Removing the link restores
the original independent series.

History and Settings expose **Same progression series**. Each historical identity
can be linked manually, accepted as an unambiguous exact compatible match,
added to the Library under its original ID, or marked **Keep as separate
history**. Bulk exact matching accepts only unique matches. Reviewed decisions
can be shown and changed later. The banner can be dismissed for the current set
of unresolved IDs; importing a genuinely new identity changes the signature and
shows it again.

Manual choices, merge operations, imported links, and restored links all
enforce the same measurement, load-mode, and equipment-key contract. Movement
family remains an independent volume grouping. Machine stacks require the same nonempty equipment key. The selector
only offers compatible Library exercises. A merge rewrites routine and active
workout references, removes the obsolete library definition, and creates this
analytics join; finished workout snapshots remain unchanged.

A history import always leaves an inline result with separate counts for new,
already-present, invalid, and conflicting workouts. This result and the review
entry are shown even when every imported workout already exists, which is the
recovery path for older imports that predate reconciliation.

Browser regression coverage lives in `tests/regression.cjs`. With Node and
Playwright available, run `node tests/regression.cjs`; optionally set
`BROWSER_PATH` to an installed Chromium executable. It uses an isolated browser
profile and synthetic origin, and never reads the user's workout data.

### Backup validation and HTML boundaries

`validateBackup` checks all required collections and nested object/array shapes
before migrations can traverse them. IDs are nonempty strings without control
characters. Exercise IDs, routine IDs, and workout IDs are unique in their own
collections (active and finished workouts share a scope); item IDs are unique
within a routine and set IDs within a workout. References to removed library
entries are intentionally valid. Missing optional fields from earlier versions
receive defaults; incomplete top-level collections are rejected, not emptied.
Numeric versions must be integers from 1 through the current state version.

`prepareBackup` produces an independent migrated/normalized candidate and checks
it again before returning. `applyFullBackup` prepares it before opening the
replace confirmation. Cancel and validation errors leave current data untouched.
The file reader distinguishes invalid JSON from failures in import processing.

IDs stay raw in storage, dataset lookups, and `getElementById`. Templates call
`esc` when placing them in HTML, including option values and prefixed field IDs.
This preserves unusual IDs while preventing attribute/markup injection. Numeric
input values are escaped too; URL and Markdown rendering retain their existing
specialized handling. Test commands and setup are in `tests/README.md`.

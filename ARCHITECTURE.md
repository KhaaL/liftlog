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
before adding anything that needs a build step.

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
| `DOMAIN CONSTANTS` | The closed vocabularies: units, themes, bounds, shortcuts |
| `STORAGE` | `localStorage` read/write, schema migrations, normalization |
| `REMOTE STORAGE` | Optional S3-compatible backup/restore, config, request signing |
| `SEED / SAMPLE DATA` | The starting exercise library and program routines |
| `STATE` | `state` (persisted) and `ui` (transient), navigation |
| `FEEDBACK` | Toasts, screen-reader announcements, the confirm dialog |
| `REST TIMER` | Timer model, persistence across reloads, scheduled beep, wake lock, painting |
| `PERFORMANCE LOOKUPS` | Per-exercise history aggregates |
| `ACTIONS — *` | State mutations, grouped by the screen that triggers them |
| `RENDERING` | `render()` plus pure `viewX()` / `htmlX()` string builders |
| `EVENT HANDLING` | Delegated `click` / `input` / `change` / `submit` listeners |
| `KEYBOARD SHORTCUTS` | Global key handling |
| `INIT` | Theme, timer restore, first paint |

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
  the exercises the sheet draws as reorderable rows: upcoming, not skipped, not
  already finished, not the current one. It has to agree exactly with the
  else-branch of `overviewSheetHTML()`, and it is a list of positions rather
  than a range because they are not always contiguous — jumping back to an
  earlier exercise leaves anything you had already finished sitting among the
  ones still to come. Reordering deals the exercises back into the same set of
  positions, so no done or current index (nor `ui.expandedDone`, which is keyed
  by index) can move however far a row travels.

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
├─ settings        { theme, unit, defaultRest, autoRest, sound, effortMetric,
│                    lastFileBackupAt, seededAt }
├─ exercises[]     { id, name, category, unit, notes }        — the library
├─ routines[]      { id, name, items[] }                      — the plan
│   └─ items[]     { id, exerciseId, sets, reps, weight, rest }
├─ workouts[]      logged sessions, newest first              — the log
│   └─ exercises[] { exerciseId, name, unit, targetReps, restSeconds, skipped, sets[] }
│       └─ sets[]  { id, weight, reps, durationSeconds, rpe, rir, unit, completed, completedAt,
│                    countForVolume?, countForPR? }   — absent means "counts"
└─ activeWorkout   a workout in progress, or null
```

### Durability

The log lives under one `localStorage` key (`liftlog.v1`), rewritten in full by
`save()` on every mutation. Three things guard it, because `localStorage` is
neither guaranteed nor permanent:

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
- **A completed set is a record, not a plan.** Nothing that propagates a
  planned value may touch one. `cascadeWeight()` writes a committed weight down
  to every later set in the exercise, skipping completed ones; `deleteSet()`
  asks before removing one, and does not ask otherwise (`addSet()` pre-fills a
  new row from the set above it, so "this row has a weight in it" says nothing
  about whether the user typed anything).
- **`ui.expandedDone` is keyed by position in `activeWorkout.exercises`.**
  Anything that inserts or removes an exercise invalidates every key after it,
  so it is cleared — see `confirmExerciseRemoval()`. Reordering is deliberately
  scoped to the upcoming sub-range for the same reason.
- **Execution and analytics are separate.** `completed` says the set was
  performed; `countForVolume` / `countForPR` (default true) say whether it counts
  toward totals and records. A warm-up is `completed: true` with both flags
  false — it is still shown in history, marked as a warm-up.
- **`rpe` and `rir` are independent fields on a set, but only one shows as an
  input at a time.** `settings.effortMetric` (`'none' | 'rpe' | 'rir'`) is a
  single global choice, not per-exercise — logging one style of set at a time
  is the common case, and a per-exercise setting would need its own UI and
  migration for one column's worth of value. Both fields still round-trip
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

`load()` runs migrations in sequence for older data:

- **v1 → v2** — refreshes the seed exercise library and routines to the
  current sample data, keeps logged workouts and preferences.
- **v2 → v3** — moves seconds out of `reps` into `durationSeconds`; adds the
  `countForVolume` / `countForPR` split.

Data that cannot be read — corrupt JSON, an unrecognized shape, or a *newer*
schema version — is never overwritten in place. It is copied to
`localStorage['liftlog.v1.unreadable']` and the app starts from seed with a
warning, so a bad parse or a downgrade is always recoverable by hand.

## Import / export

Four flows, all plain JSON (`EXPORT_SCHEMA = '1.0.0'`). Every file names itself
with `app: 'liftlog'` and a `kind`:

- **`backup`** — the entire `state`; importing replaces everything. Built by
  `backupPayload()`, which is also what the remote PUT uploads, so the file in
  your downloads folder and the object in your bucket are the same thing. It is
  a deep copy of the whole of `state`, so **every** setting travels with it
  (theme, unit, default rest, auto-rest, sound, effort metric, and the backup
  stamps) and a restore puts them all back. The one deliberate exception is the
  remote-storage config: it lives under its own `localStorage` key and stays on
  the device, so a backup file — including the copy sitting in the bucket —
  never carries bucket credentials.
- **`routines`** — routines plus the exercise definitions they reference, so an
  import into another browser can rebuild missing library entries. Exercises are
  resolved by id, then by name, then created. Duplicate names are skipped.
- **`history`** — workouts, with an explicit `setType` (`reps` / `time` / `hold` /
  `distance`) on every set so importers never guess at field semantics.
  Deduplicated by workout id; first write wins.
- **`remote-config`** — the remote-storage settings, optionally without the
  secret key. See [Remote storage](#remote-storage-optional).

`kind` exists because a routines file and a backup are not distinguishable by
shape: both carry a `version` and an `exercises` array, so the full-backup
importer used to accept a routines file and "restore" a state with no history
and default settings. `applyFullBackup()` now turns away anything that names
itself as another kind. Files predating the marker have no `kind` and are still
accepted on shape alone.

Legacy files without `setType` fall back to the exercise/set unit, and
`includeInVolume` is accepted as an alias of `countForVolume`.

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

Once configured, **Backup now** and **Restore from remote** are manual,
on-demand actions — there is no background sync, and restore always confirms
before it overwrites what's on this device (the same confirmation as a local
file import).

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
- **Manual, not sync.** There's no conflict resolution because there's no
  automatic sync — each Backup/Restore fully overwrites one side, on request.

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
  `#overview-dlg` listens for `close` and writes `ui.overviewOpen` back —
  guarded, so the `close()` a render just issued does not start another render.
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
Sans most Linux desktops, DejaVu and Liberation the rest.

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

**No gesture is the only way in.** The long press that marks a warm-up
(`data-longpress` on the done cell) has no keyboard equivalent, so the set
number stays an ordinary button with the same toggle on it. A drag handle has
no keyboard equivalent either, so it answers the arrow keys itself and keeps
the up/down buttons beside it. Anything reachable only by holding a finger down
is a bug.

## Testing

There is no automated suite yet — see [ENHANCEMENTS.md](ENHANCEMENTS.md). When
changing behaviour, exercise at least: start a routine, log and un-log a set,
the rest timer across a reload, finish a workout, edit a logged session, a kg/lb
switch, an export/import round trip, and (if touching remote storage) saving a
config, a failed connection test, and a backup/restore round trip against a
real S3-compatible bucket.

Also exercise the set row: log a set from its own box in the done column (and
check auto-rest starts), mark a set as a warm-up both by long-pressing that box
and from the set number, confirm the session volume does not move when a warm-up
is completed, and reclassify a logged set in the history editor. The long press
needs its edges checked: a press that turns into a scroll must not mark
anything, the tap that ends the press must not also log the set, and a plain tap
straight afterwards must. Warm-up marking has two entry points because the
set-number cell is dropped below 360px when an effort column is on — worth
checking at 320px too.

And the session picker: it lists the library A–Z, leaves out what is already in
the session, and refuses a duplicate even if a stale value is submitted.

The session sheet needs its modal edges checked: Esc, the scrim, the X and
"Back to workout" all close it and return focus to the strip button; a reorder
or an add refills it without it blinking shut; keyboard shortcuts do not fire
behind it; discarding raises the confirm dialog *over* it and closes both; and
on a phone the page behind must not scroll.

Dragging a row is worth its own pass, by finger as well as by mouse. A drag
that starts anywhere but the grip must scroll the sheet instead. A drag that
ends where it began, one cancelled by the system, and one interrupted by Esc
must all leave the order untouched and no row stuck mid-air. A flick past
several rows at once must land where it looks like it landed. And the case the
index arithmetic exists for: finish an exercise, jump ahead and finish another,
jump back — the finished one now sits among the exercises still to come, and
dragging a row past it must step over it without moving it.

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

# Liftlog

A quiet, local-first gym workout tracker. Log sets, time rests, review progress.
Everything lives in `localStorage` by default — nothing is uploaded anywhere
unless you deliberately configure remote storage yourself (see below).

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

Handlers receive the element's `dataset`, so parameters travel as `data-id`,
`data-idx`, `data-field`, `data-sid`.

## Layout on a phone

The active-workout screen is built around a fixed vertical budget, because a
phone in a gym is the case that matters:

- **The action bar** (`.actionbar`, `htmlActionBar()`) is sticky along the
  bottom edge and holds *both* the rest timer and the set actions. These used
  to be two elements — a full-width timer panel and a sticky button row — and
  the panel rendered around 500px below the fold, so on a phone the timer was
  off-screen at exactly the moment a logged set started it. Anything needed
  between sets belongs in this bar. A set is *not* logged from here: that is the
  done column's job (`toggleSet()`), which is also what starts auto-rest. The
  bar carries the timer and what moves the session on.
- **The session strip** (`.session-strip`, `htmlSessionStrip()`) is sticky
  directly under the header and answers "where am I": exercise *n* of *m*, its
  name, sets done, a finish estimate, and one progress segment per exercise
  weighted by its set count. It sticks at `top:var(--header-h)`, which
  `trackHeaderHeight()` keeps in sync with the header's real height.
- **Everything occasional is one tap away, not always on screen.** Adding an
  exercise and discarding the workout live in the session-overview drawer; the
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
  real gesture, which is when a grant is most likely. Settings reports the
  answer, and offers a retry if the browser said no.
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
  hidden while it's not selected.
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
  your downloads folder and the object in your bucket are the same thing.
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
  `#timer-panel`, `#timer-time`, `#timer-fill`, `#timer-status` and
  `#timer-toggle` singly, so exactly one copy of the action bar may be in the
  document. Two would leave the second silently unpainted.
- **Closed vocabularies live in `DOMAIN CONSTANTS`.** Units, themes, rest bounds,
  routine-item bounds, set types and the shortcut list each have exactly one
  definition, and the templates, validators and importers all read from it. The
  keyboard help dialog and the Settings shortcut table are both rendered from
  `SHORTCUTS`; the import-format reference reads `ITEM_LIMITS`, `UNITS` and
  `SET_TYPES`.
- **A `<dialog>` that sets `display` must scope it to `[open]`.** An unqualified
  `display:flex` on a dialog outranks the UA sheet's
  `dialog:not([open]){display:none}`, leaving a closed dialog laid out on top of
  the page and swallowing clicks. See `.dlg-wide[open]`.
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
(`data-longpress` on the done cell, delegated like `data-action`) has no
keyboard equivalent, so the set number stays an ordinary button with the same
toggle on it. Anything reachable only by holding a finger down is a bug.

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

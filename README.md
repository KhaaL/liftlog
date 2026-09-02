# Liftlog

A quiet, local-first gym workout tracker. Log sets, time rests, review progress.
Everything lives in `localStorage` by default — nothing is uploaded anywhere
unless you deliberately configure remote storage yourself (see below).

## Running it

Open `index.html` in a browser. That is the whole install step.

The app is a single self-contained file with **no build step and no
dependencies**. That is a deliberate constraint: it has to work from a
`file://` URL, from a USB stick, or from any static host. Please keep it that way
— see [ENHANCEMENTS.md](ENHANCEMENTS.md) for how to relax it if the file ever
outgrows a single document.

### Which build am I running?

The footer shows a build reference — `branch@commit` — instead of a version
number, so a copy on a phone can be traced back to source. There is no build
step to compute it, so it is stamped in by hand:

```sh
tools/stamp-build.sh            # write the current branch/commit into index.html
tools/stamp-build.sh --reset    # restore the 'unstamped' placeholders
```

Run it on the checked-out tree before copying `index.html` to a host and the
stamp is exact for what you ship. If you deploy by committing instead, the
stamp names the commit you ran it on — the parent of the commit it lands in —
because a file cannot contain the hash of the commit it becomes part of. An
unstamped copy says so rather than claiming a version it cannot verify.

By default the app also makes **no network calls at all** — the only exception
is the optional remote storage feature below, and even then every request goes
directly from your browser to storage you configure, never through any server.

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
  off-screen at exactly the moment `completeCurrentSet()` started it. Anything
  needed between sets belongs in this bar.
- **The session strip** (`.session-strip`, `htmlSessionStrip()`) is sticky
  directly under the header and answers "where am I": exercise *n* of *m*, its
  name, sets done, a finish estimate, and one progress segment per exercise
  weighted by its set count. It sticks at `top:var(--header-h)`, which
  `trackHeaderHeight()` keeps in sync with the header's real height.
- **Everything occasional is one tap away, not always on screen.** Adding an
  exercise and discarding the workout live in the session-overview drawer; the
  rest presets live in the action bar's sheet; the session note collapses to a
  button until it has content; the RPE column is off until a set carries a
  value.
- **Column templates are one custom property.** `--sets-cols` on `.sets` has a
  variant per shape (`.no-rpe`, `.no-weight`) rather than four grid
  declarations, and the narrow breakpoint overrides the same four.
- Below 640px the per-row field captions are hidden — the head row already
  names the columns — so every set input carries an explicit `aria-label`.

## Data model

```
state
├─ version         schema version (SCHEMA_VERSION)
├─ settings        { theme, unit, defaultRest, autoRest, sound }
├─ exercises[]     { id, name, category, unit, notes }        — the library
├─ routines[]      { id, name, items[] }                      — the plan
│   └─ items[]     { id, exerciseId, sets, reps, weight, rest }
├─ workouts[]      logged sessions, newest first              — the log
│   └─ exercises[] { exerciseId, name, unit, targetReps, restSeconds, skipped, sets[] }
│       └─ sets[]  { id, weight, reps, durationSeconds, rpe, unit, completed, completedAt }
└─ activeWorkout   a workout in progress, or null
```

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
- **Execution and analytics are separate.** `completed` says the set was
  performed; `countForVolume` / `countForPR` (default true) say whether it counts
  toward totals and records. A warm-up is `completed: true` with both flags
  false — it is still shown in history, marked as a warm-up.
- **Everything crossing the boundary is validated.** `normalizeState()` and the
  `normalizeImported*()` functions clamp units, themes, numbers and free text on
  the way in, so the render layer never has to defend against stray strings.
  All interpolated values are escaped with `esc()`.

### Schema migrations

`load()` runs migrations in sequence for older data:

- **v1 → v2** — replaces the sample library and routines with the real program,
  keeps logged workouts and preferences.
- **v2 → v3** — moves seconds out of `reps` into `durationSeconds`; adds the
  `countForVolume` / `countForPR` split.

Data that cannot be read — corrupt JSON, an unrecognized shape, or a *newer*
schema version — is never overwritten in place. It is copied to
`localStorage['liftlog.v1.unreadable']` and the app starts from seed with a
warning, so a bad parse or a downgrade is always recoverable by hand.

## Import / export

Three separate flows, all plain JSON (`EXPORT_SCHEMA = '1.0.0'`):

- **Full backup** — the entire `state`; importing replaces everything.
- **Routines** — routines plus the exercise definitions they reference, so an
  import into another browser can rebuild missing library entries. Exercises are
  resolved by id, then by name, then created. Duplicate names are skipped.
- **History** — workouts, with an explicit `setType` (`reps` / `time` / `hold` /
  `distance`) on every set so importers never guess at field semantics.
  Deduplicated by workout id; first write wins.

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

There is no "load sample data" button. It replaced the user's library and
routines with one person's training program, which is not a thing an app should
offer to do; importing a file you chose is the same convenience without the
surprise.

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
| Endpoint URL | Your provider's S3 endpoint, e.g. `https://s3.us-east-1.amazonaws.com`, `https://<account id>.r2.cloudflarestorage.com`, or your own MinIO URL. Must be `https://` — credentials are never sent over plain HTTP. |
| Region | e.g. `us-east-1`. Cloudflare R2 uses `auto`. |
| Bucket | The bucket to back up into. |
| Object key / path | Where the backup is stored inside the bucket. Defaults to `liftlog-backup.json`. |
| Access key ID / Secret access key | Credentials for that bucket. Scope them to just this bucket, and to just `GetObject`/`PutObject`, if your provider supports it. |
| Path-style addressing | Turn on for MinIO and most self-hosted endpoints; leave off for AWS S3, R2, B2 and Spaces. |

Instead of the form, you can load a JSON config file with the same fields
(`endpoint`, `region`, `bucket`, `accessKeyId`, `secretAccessKey`, `objectKey`,
`pathStyle`) via **Load config file** — handy if you keep the setup elsewhere
and don't want to retype it. Treat that file like a credential: it contains
your secret key in plain text.

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

## Accessibility

Keyboard shortcuts (`?` for the full list) are disabled while typing. Live
regions announce set completion, rest completion and workout restore. The rest
timer uses `<output>`, dialogs are native `<dialog>`, and
`prefers-reduced-motion` disables animation. Themes are token-driven, so a new
theme is one `:root[data-theme="…"]` block plus an entry in `THEMES`.

## Testing

There is no automated suite yet — see [ENHANCEMENTS.md](ENHANCEMENTS.md). When
changing behaviour, exercise at least: start a routine, log and un-log a set,
the rest timer across a reload, finish a workout, edit a logged session, a kg/lb
switch, an export/import round trip, and (if touching remote storage) saving a
config, a failed connection test, and a backup/restore round trip against a
real S3-compatible bucket.

# Liftlog

A quiet, local-first gym workout tracker. Log sets, time rests, review progress.
Everything lives in `localStorage` — nothing is uploaded anywhere.

## Running it

Open `index.html` in a browser. That is the whole install step.

The app is a single self-contained file with **no build step, no dependencies and
no network calls**. That is a deliberate constraint: it has to work from a
`file://` URL, from a USB stick, or from any static host. Please keep it that way
— see [ENHANCEMENTS.md](ENHANCEMENTS.md) for how to relax it if the file ever
outgrows a single document.

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
| `SEED / SAMPLE DATA` | The starting exercise library and program routines |
| `STATE` | `state` (persisted) and `ui` (transient), navigation |
| `FEEDBACK` | Toasts, screen-reader announcements, the confirm dialog |
| `REST TIMER` | Timer model, persistence across reloads, painting |
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

## Conventions

- **Styling goes in the stylesheet.** Templates use classes (including the small
  layout utilities `.mt-*`, `.mb-*`, `.flex-*`, `.divider-top`, …). The only
  inline style left is the one genuinely computed value — the progress bar width.
- **Closed vocabularies live in `DOMAIN CONSTANTS`.** Units, themes, rest bounds,
  routine-item bounds and the shortcut list each have exactly one definition, and
  the templates, validators and importers all read from it. The keyboard help
  dialog and the Settings shortcut table are both rendered from `SHORTCUTS`.
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
switch, and an export/import round trip.

# Browser checks

The app has no runtime dependencies. These development checks need Node.js 22
or later and Playwright, which `package.json` pins as the repository's only
(dev) dependency. From the repository root:

```sh
npm ci                                     # installs the pinned playwright
npx playwright install --only-shell chromium   # or set BROWSER_PATH instead
npm test                                   # both suites
```

`npm run test:regression` and `npm run test:security` run one suite each, and
`node tests/<suite>.cjs` works from any directory. Set `BROWSER_PATH` to an
installed Chromium to use it instead of Playwright's own download.

Both scripts launch an isolated browser profile and intercept HTTP requests;
they do not touch your real workout data or a remote backup. The security suite
also mocks remote storage to exercise the real restore/validation path.

- `regression.cjs`: samples, routine pairing, supersets (pair rules, group
  cursor, rest per round, session-only lifetime), detail sheets (routine,
  exercise and session sheets, their edit hand-over, focus return and toasts
  above a sheet), targets, historical exercise
  reconciliation, measurement semantics, bodyweight/added-load analytics,
  archive/merge behavior, progression-series compatibility and movement-family
  metadata, progression stalls/load-increase cues, debounced persistence, automatic
  remote backup/startup restore, migration, restore, reload, and mobile layout.
  Screenshots are written under `/tmp`, including the routine editor, workout,
  routine and session sheets, history progression, and mobile Settings views.
- `security.cjs`: nested backup validation, duplicate ID scopes, legacy versions,
  cancellation, hostile IDs through imports and UI actions, remote validation,
  startup recovery download/discard, and failure to save a recovery copy.

## The test seam

The suites reach the app's internals through `window.testAPI`, which exists
only in the copy of `index.html` they serve to themselves. `harness.cjs` builds
that copy by replacing the one marker line `/* @test-seam */`, just before
`init();` at the end of the script, with an object literal naming the functions
each suite needs. Code inserted there runs inside the app's closure, which is
why it can refer to them by name. No test API is added to the shipped
application.

If the marker is missing or appears twice, `harness.cjs` stops before any
browser starts and says so. A function renamed or removed in the app shows up
as a `ReferenceError` naming it, because the object literal is evaluated when
the page loads.

## Continuous integration

`.github/workflows/tests.yml` runs both suites on every pull request and on
pushes to `main`, inside `mcr.microsoft.com/playwright` at the same version as
`package.json`. When bumping Playwright, change both. The image pins the fonts
as well as the browser, and that matters: several checks measure layout at
phone widths, and text metrics decide them. Screenshots from a failed run are
kept as a workflow artifact.

Locally, results can differ if your machine renders the app's font stack
differently — on Linux the stack falls back to Liberation Sans, then DejaVu
Sans (see **Typography** in [ARCHITECTURE.md](../ARCHITECTURE.md)).

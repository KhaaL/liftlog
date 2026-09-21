# Browser checks

The app has no runtime dependencies. These optional development checks require
Node.js, the `playwright` package, and a Chromium browser. Playwright must be
resolvable by Node (a local installation or `NODE_PATH` both work). Set
`BROWSER_PATH` to an existing Chromium executable, or install Playwright's
Chromium with `npx playwright install chromium`.

From the repository root:

```sh
node tests/regression.cjs
node tests/security.cjs
```

Both scripts launch an isolated browser profile and intercept HTTP requests;
they do not touch your real workout data or a remote backup. The security suite
also mocks remote storage to exercise the real restore/validation path.

- `regression.cjs`: samples, routine pairing, targets, historical exercise
  reconciliation, migration, restore, reload, and mobile layout. Screenshots
  are written to `/tmp/liftlog-pair-picker.png`, `/tmp/liftlog-editor.png`, and
  `/tmp/liftlog-workout.png`.
- `security.cjs`: nested backup validation, duplicate ID scopes, legacy versions,
  cancellation, hostile IDs through imports and UI actions, remote validation,
  startup recovery, and failure to save a recovery copy.

The scripts expose selected functions only in the HTML response used by the
tests. No test API is added to the shipped application.

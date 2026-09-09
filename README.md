> **Authors notes**
> _This software was vibe-coded to help me create a simple, noise-less app to track my workouts. It is intended for mobile devices first and foremost, and aims to keep the architecture simple and lean._
> _The rest of the readme is AI-generated. Hope this software is of use to you!_

# Liftlog

A gym workout tracker that is one HTML file. Open it and it runs — no
account, no install step, no server, no build.

## The pitch

Every other tracker asks you to trust a company with your training log, your
email, and a subscription. Liftlog is the opposite bet: **your data never
leaves your device unless you tell it to.** It logs sets and rests entirely
in the browser's own storage, works with the network off, and can be
installed to a home screen so it survives exactly like a native app — while
still being, underneath, a single document you could read start to finish in
an evening.

If you ever want a copy elsewhere, you point it at your own S3-compatible
bucket. Nobody else's server is ever in the loop.

## Design principles

- **Local-first, not local-only.** Nothing is uploaded by default. The one
  exception — remote backup — is opt-in, goes straight from your browser to
  storage you configure yourself, and can be turned off without losing
  anything.
- **One file is the whole app.** No framework, no bundler, no `npm install`.
  Opening `index.html` from disk is a fully supported way to run it, not a
  fallback.
- **Designed for the hand it's actually held in.** The primary device is a
  phone, gripped one-handed, mid-set, in a gym. Layout is built around a
  fixed vertical budget and 44px touch targets, not shrunk down from a
  desktop design.
- **Every fact appears once.** If the screen already says which exercise
  you're on, nothing else on it says it again. Redundant chrome is a bug, not
  a feature.
- **No gesture is the only way in.** Anything reachable by holding a finger
  down (marking a warm-up, dragging to reorder) is also reachable from the
  keyboard and a plain tap.
- **Honest about its limits.** Where a trade-off costs something — plaintext
  credentials for remote storage, no automated test suite, no conflict
  resolution on sync — that's stated plainly rather than glossed over.

## Running it

Open `index.html` in a browser. That's the whole install step, and it works
from a `file://` URL or a USB stick.

For the installable/offline version, serve it over `https://` or
`localhost` — any static host works, `python3 -m http.server` is enough to
try it locally.

## Deploying to GitHub Pages

The app has no build step, so Pages can serve the repo as-is:

1. On GitHub: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick the branch to publish (e.g. `main`) and folder `/ (root)`.
4. Save. GitHub builds and gives you a URL at
   `https://<user>.github.io/<repo>/` within a minute or two.

Every push to that branch redeploys automatically — no CI config needed.
Two things worth knowing:

- The service worker caches by file list (see `sw.js`), so after changing
  which static files ship, bump `CACHE` there or previously-installed
  clients will keep serving the old set.
- `manifest.webmanifest`'s icon paths are relative, so they resolve
  correctly whether Pages serves the app from the domain root or a
  `/<repo>/` subpath — no changes needed for a project-page URL.

## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the code is organized, the render
  loop, gestures, layout decisions, the data model, and what to test by hand.
- [ENHANCEMENTS.md](ENHANCEMENTS.md) — what's deliberately not built yet, and
  why.

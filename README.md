> **Author's note:**
> _This software was vibe-coded to help me create a simple, noise-less app to track my workouts. It is intended for mobile devices first and foremost, and aims to keep the architecture simple and lean._
> _The rest of the readme is AI-generated. Hope this software is of use to you!_

# Liftlog

A gym workout tracker that is one HTML file. Open it and it runs.

## The pitch

Liftlog is built on the principle that your data never
leaves your device unless you tell it to. It logs sets and rests entirely
in the browser's own storage, works with the network off, and can be
installed to a home screen so it survives exactly like a native app — while
still being, underneath, a single HTML file.

If you ever want a copy elsewhere, you point it at your own S3-compatible
bucket. 

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


## Running it

Open `index.html` in a browser. That's the whole install step, and it works
from a `file://` URL or a USB stick.

For the installable/offline version, serve it over `https://` or
`localhost` — any static host works, `python3 -m http.server` is enough to
try it locally.


## Further reading

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the code is organized, the render
  loop, gestures, layout decisions, the data model, and what to test by hand.
- [ENHANCEMENTS.md](ENHANCEMENTS.md) — what's deliberately not built yet, and
  why.

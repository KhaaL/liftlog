/* Liftlog service worker — the offline shell for the installed app.

   Two jobs, both in service of the data rather than the loading time:
   an installed app opens with no network at all, and being installable is
   what earns an exemption from the storage clearing iOS applies to sites not
   visited for a week (see the Storage block in Settings).

   Nothing about a workout is cached here — the log lives in localStorage, and
   remote backups go to another origin, which this worker deliberately never
   touches. This caches the document and its icons, nothing else.

   CACHE needs a new version whenever any shell file OTHER than the document
   changes — its name or its contents. The document is the one exception: it is
   served stale-while-revalidate, so an edited index.html is picked up on the
   next launch without a bump. Everything else below is served cache-first and
   never revalidated, so a changed manifest or icon is invisible until the
   version here moves and activate() drops the old cache.

   v2, v3, v4: manifest.webmanifest's theme_color changed. Chrome reads that
   file to decide the status bar colour of the installed app, so a stale cached
   copy would have kept handing it the old value indefinitely. Twice now the
   bump was the part that made the change real, which is a bad thing to have to
   remember — so the manifest is network-first from here (see below) and a
   future colour change needs no version bump at all. */

const CACHE = 'liftlog-shell-v4';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* The page asks for this once it has told the user an update is waiting. The
   worker never takes over on its own: an unasked-for reload in the middle of a
   logged set is exactly the kind of surprise this app avoids. */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  /* Anything off-origin is the user's own storage bucket. Never cached, never
     touched — those requests are signed and go straight through. */
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate'){
    event.respondWith(cachedDocument(req));
    /* respondWith already answered from cache; this is purely background
       work, so it needs its own waitUntil or the worker can be recycled
       mid-fetch and the refresh silently never happens. */
    event.waitUntil(refreshDocument(req));
    return;
  }
  /* The manifest is network-first, unlike every other sub-resource here.
     Chrome re-reads it to decide whether the installed app needs updating —
     its icon, its name, the status bar colour — so serving a stale copy does
     not cost a stale pixel, it silently pins the installed app to whatever it
     was built with. It is a few hundred bytes and it falls back to the cache
     offline, so there is nothing to win by caching it first. */
  if (new URL(req.url).pathname.endsWith('/manifest.webmanifest')){
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || Response.error()))
    );
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

/* Serves the cached document immediately so an offline launch is instant. */
function cachedDocument(req){
  return caches.open(CACHE).then(cache =>
    cache.match(req)
      .then(hit => hit || cache.match('./index.html'))
      .then(hit => hit || fetch(req)));
}

/* Refreshes the cached document in the background so the next launch is up
   to date, and — unlike the SKIP_WAITING message above, which the page only
   ever sends when this file's own bytes changed — tells any open tab when
   the document itself actually changed. A content-only edit (the common
   case: nothing here in sw.js changes) never triggers 'updatefound', so
   without this an update could sit fully cached and ready with no toast
   ever telling anyone a reload would pick it up. */
function refreshDocument(req){
  return caches.open(CACHE).then(cache => cache.match(req).then(old =>
    fetch(req).then(res => {
      if (!res || !res.ok) return;
      const put = cache.put(req, res.clone());
      if (!old) return put;   /* nothing cached yet to compare against */
      return Promise.all([old.text(), res.clone().text(), put]).then(([oldText, newText]) => {
        if (newText !== oldText) return notifyClientsOfUpdate();
      });
    }).catch(() => null)
  ));
}

function notifyClientsOfUpdate(){
  return self.clients.matchAll({ type:'window' }).then(clients =>
    clients.forEach(c => c.postMessage({ type:'CONTENT_UPDATED' })));
}

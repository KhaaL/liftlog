/* Liftlog service worker — the offline shell for the installed app.

   Two jobs, both in service of the data rather than the loading time:
   an installed app opens with no network at all, and being installable is
   what earns an exemption from the storage clearing iOS applies to sites not
   visited for a week (see the Storage block in Settings).

   Nothing about a workout is cached here — the log lives in localStorage, and
   remote backups go to another origin, which this worker deliberately never
   touches. This caches the document and its icons, nothing else.

   CACHE only needs a new version when SHELL changes: the document itself is
   served stale-while-revalidate, so an edited index.html is picked up on the
   next launch without any version bump. */

const CACHE = 'liftlog-shell-v1';
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
    event.respondWith(freshOrCachedDocument(req));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

/* Serves the cached document immediately so an offline launch is instant, and
   refreshes the cache in the background so the next launch is up to date. */
function freshOrCachedDocument(req){
  return caches.open(CACHE).then(cache => {
    const network = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cache.match(req)
      .then(hit => hit || cache.match('./index.html'))
      .then(hit => hit || network.then(res => res || fetch(req)));
  });
}

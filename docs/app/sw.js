// doodleduo service worker: keeps the app working offline. Its scope is the app folder, so it
// works the same at the site root or under a sub-path such as /doodleduo/app/.

// precache:start
const CACHE_VERSION = '3aa4671dc876';
const PRECACHE = [
  './',
  'app.css',
  'core/blobs.js',
  'core/bytes.js',
  'core/crdt.js',
  'core/crypto.js',
  'core/format.js',
  'core/geometry.js',
  'core/invite.js',
  'core/mesh.js',
  'core/mqtt.js',
  'core/pairing.js',
  'core/qr.js',
  'core/relay.js',
  'core/rendezvous.js',
  'core/rtc.js',
  'core/sha256.js',
  'core/shapes.js',
  'core/smooth.js',
  'core/svg.js',
  'core/wordlist.js',
  'core/words.js',
  'icons.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/maskable-512.png',
  'icons/maskable.svg',
  'index.html',
  'js/canvas.js',
  'js/db.js',
  'js/exporter.js',
  'js/i18n.js',
  'js/images.js',
  'js/main.js',
  'js/session.js',
  'js/words-ui.js',
  'manifest.webmanifest',
  '../favicon.svg',
  '../assets/head-dark.svg',
  '../assets/mascot-dark.svg',
];
// precache:end

const CACHE = `doodleduo-${CACHE_VERSION}`;
const EXTERNAL = [
  'https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.min.css',
  'https://cdn.jsdelivr.net/npm/voodoojs@1.0.0/dist/voodoo.full.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all([cache.addAll(PRECACHE), ...EXTERNAL.map((u) => cache.add(new Request(u, { mode: 'cors' })).catch(() => {}))]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('doodleduo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for the app files, so an update shows on the next visit; the cache answers
// when offline. Everything else (fonts, the CDN files) is cache first.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const own = url.origin === self.location.origin;
  if (own) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
    );
  } else {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok || res.type === 'opaque') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

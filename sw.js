// Hyperwave Sensors Lite — keeps the app shell available so it opens instantly from the home screen.
// Live data (Twitch, YouTube) always goes straight to the network.
const CACHE = 'hws-lite-0.0.13';
const SHELL = ['./', 'index.html', 'style.css', 'lite.css', 'config.js', 'shared.js', 'app.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'taii-logo.png', 'tip-qr.png', 'about.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first (so updates arrive), cache as fallback when offline
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});

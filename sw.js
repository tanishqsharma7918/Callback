/* Callback offline cache — callback-106dc28af40e */
const VERSION = 'callback-106dc28af40e';
const ASSETS = [
 "./",
 "ai.js",
 "app.js",
 "apple-touch-icon.png",
 "assistant.js",
 "ats.js",
 "charts.js",
 "core.js",
 "exceljs.min.js",
 "favicon-32.png",
 "fonts.css",
 "icon-192.png",
 "icon-512.png",
 "icon-maskable-512.png",
 "index.html",
 "io.js",
 "jszip.min.js",
 "mammoth.browser.min.js",
 "manifest.webmanifest",
 "mascot.js",
 "pdf.min.js",
 "pdf.worker.min.js",
 "samples.js",
 "skills.js",
 "store.js",
 "three.min.js",
 "views.js",
 "viz3d.js"
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then((cache) => cache.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit || caches.match('./'));
    return hit || net;
  })));
});

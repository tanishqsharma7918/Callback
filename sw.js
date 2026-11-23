/* Callback offline cache — callback-c670c055e880 */
const VERSION = 'callback-c670c055e880';
const ASSETS = [
 "./",
 "fonts/fonts.css",
 "icons/apple-touch-icon.png",
 "icons/favicon-32.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-512.png",
 "index.html",
 "js/ai.js",
 "js/app.js",
 "js/assistant.js",
 "js/ats.js",
 "js/charts.js",
 "js/core.js",
 "js/io.js",
 "js/mascot.js",
 "js/samples.js",
 "js/skills.js",
 "js/store.js",
 "js/views.js",
 "js/viz3d.js",
 "lib/exceljs.min.js",
 "lib/jszip.min.js",
 "lib/mammoth.browser.min.js",
 "lib/pdf.min.js",
 "lib/pdf.worker.min.js",
 "lib/three.min.js",
 "manifest.webmanifest"
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

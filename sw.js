const CACHE_NAME = 'pocketmu-cache-v3';
const urlsToCache = [
    './',
    './index.html',
    './manifest.json'
];

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request)
        .then(response => response || fetch(e.request))
    );
});
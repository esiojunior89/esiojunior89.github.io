const CACHE_NAME = 'pocketmu-cache-v4';
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
    // Essa parte garante que caches antigos e travados sejam deletados
    e.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
    // Estratégia Network First (Sempre tenta a internet antes do offline)
    e.respondWith(
        fetch(e.request).then(response => {
            // Se tem internet, pega a versão mais nova e já atualiza o cache escondido
            let responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
                cache.put(e.request, responseClone);
            });
            return response;
        }).catch(() => {
            // Se falhou (sem internet), aí sim puxa do cache offline
            return caches.match(e.request);
        })
    );
});

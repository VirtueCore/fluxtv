const CACHE_NAME = 'fluxtv-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/static/css/main.css',
    '/static/css/responsive.css',
    '/static/js/api.js',
    '/static/js/app.js',
    '/static/js/player.js',
    '/static/js/navigation.js',
    '/static/js/search.js',
    '/static/js/manage.js',
    '/static/icons/icon.svg',
    '/static/manifest.json',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Do not cache API or external provider iframes
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/static/logos')) {
        return;
    }
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
            if (event.request.method === 'GET' && response.ok && url.origin === location.origin) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
        }))
    );
});

const CACHE_NAME = 'p3-reader-cache-v1';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  // data
  './data/math/instructions.json',
  './data/math/words.json',
  './data/math/patterns.json',
  './data/science/instructions.json',
  './data/science/words.json',
  './data/science/patterns.json',
  './data/english/instructions.json',
  './data/english/words.json',
  './data/english/patterns.json',
  './data/social_studies/instructions.json',
  './data/social_studies/words.json',
  './data/social_studies/patterns.json',
  './data/chinese/instructions.json',
  './data/chinese/words.json',
  './data/chinese/patterns.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k === CACHE_NAME ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  event.respondWith((async () => {
    const cached = await caches.match(event.request, {ignoreSearch:true});
    if(cached) return cached;
    try{
      const res = await fetch(event.request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, res.clone());
      return res;
    }catch(e){
      // offline fallback
      return caches.match('./index.html');
    }
  })());
});

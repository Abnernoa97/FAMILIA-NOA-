const CACHE = 'familia-noa-v4';
const BASE = '/FAMILIA-NOA-/';
const STATIC = [BASE + 'manifest.webmanifest', BASE + 'icons/icon-192.svg', BASE + 'icons/icon-512.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const home = await fetch(BASE, { cache: 'reload' });
      if (home.ok) await cache.put(BASE, home.clone());
    } catch {}
    await cache.addAll(STATIC);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Never proxy/cache Supabase or any other external API through the PWA worker.
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate';
  const isCode = event.request.destination === 'script' || event.request.destination === 'style' || event.request.destination === 'worker';

  if (isNavigation || isCode) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, { cache: 'no-store' });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(event.request)) || (await caches.match(BASE)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(event.request)) || Response.error();
    }
  })());
});

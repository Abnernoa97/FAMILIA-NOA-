const CACHE = 'familia-noa-v7';
const BASE = new URL(self.registration.scope).pathname;
const STATIC = [
  BASE,
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.svg',
  BASE + 'icons/icon-512.svg'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(STATIC.map(async url => {
      try {
        const response = await fetch(url, { cache:'reload' });
        if (response.ok) await cache.put(url, response.clone());
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('familia-noa-v') && key !== CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Supabase and any other external API must go directly to the network.
  // The worker only manages files served by the current app host.
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate';
  const isCode = ['script', 'style', 'worker'].includes(event.request.destination);

  if (isNavigation || isCode) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, { cache:'no-store' });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(event.request)) ||
          (isNavigation ? await caches.match(BASE) : undefined) ||
          Response.error();
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
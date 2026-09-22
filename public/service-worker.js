const CACHE = 'familia-noa-v6';
const BASE = new URL(self.registration.scope).pathname;
const APP_SHELL = new Request(BASE);
const STATIC = [
  BASE + 'manifest.webmanifest',
  BASE + 'icons/icon-192.svg',
  BASE + 'icons/icon-512.svg'
];

async function updateAppShell() {
  try {
    const response = await fetch(BASE, { cache:'no-store' });
    if (!response.ok) return;
    const cache = await caches.open(CACHE);
    await cache.put(APP_SHELL, response.clone());
  } catch {}
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await updateAppShell();
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
      keys.filter(key => key.startsWith('familia-noa-v') && key !== CACHE).map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // External APIs (including Supabase) never pass through the app cache.
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate';
  const isCode = ['script', 'style', 'worker'].includes(event.request.destination);
  const isCodePath = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  // Mobile-safe startup: serve the known-good app shell immediately, then
  // refresh it in the background. This is the proven HAVANA NICE startup rule.
  if (isNavigation) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(APP_SHELL);
      if (cached) {
        event.waitUntil(updateAppShell());
        return cached;
      }
      try {
        const response = await fetch(event.request, { cache:'no-store' });
        if (response.ok) await cache.put(APP_SHELL, response.clone());
        return response;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  if (isCode || isCodePath) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, { cache:'no-store' });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(event.request)) || Response.error();
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

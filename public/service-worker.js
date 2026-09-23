const CACHE = 'familia-noa-v33';
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

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json?.() || {}; }
    catch {
      try { payload = JSON.parse(event.data?.text?.() || '{}'); }
      catch { payload = {}; }
    }

    const title = payload.title || 'FAMILIA NOA';
    const body = payload.message || payload.body || 'Tienes una nueva actualización.';
    const tag = payload.tag || 'familia-noa';

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: BASE + 'icons/icon-192.svg',
      badge: BASE + 'icons/icon-192.svg',
      vibrate: [180, 80, 180],
      data: payload
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const payload = event.notification.data || {};
  const targetUrl = new URL(payload.url || '?presume=camera', self.registration.scope).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const existing = windows.find(client => {
      try { return new URL(client.url).origin === self.location.origin; }
      catch { return false; }
    });

    if (existing) {
      try {
        const navigated = typeof existing.navigate === 'function'
          ? await existing.navigate(targetUrl)
          : existing;
        await (navigated || existing).focus();
        return;
      } catch {}
    }

    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

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
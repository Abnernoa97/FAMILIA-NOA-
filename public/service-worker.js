const CACHE = 'familia-noa-v71';
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
    await Promise.all(keys.filter(key => key.startsWith('familia-noa-v') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of clients) {
      try { client.postMessage({ type:'FAMILIA_NOA_UPDATED', cache:CACHE }); } catch {}
    }
  })());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body:event.data?.text() || '' }; }
  const title = data.title || 'FAMILIA NOA';
  const body = data.body || data.message || 'Tienes una actualización de tu familia.';
  const options = {
    body,
    icon: BASE + 'icons/icon-192.svg',
    badge: BASE + 'icons/icon-192.svg',
    tag: data.tag || 'familia-noa',
    renotify: true,
    data: { ...data, url:data.url || BASE }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || BASE, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of windows) {
      if ('navigate' in client) {
        try { await client.navigate(target); } catch {}
      }
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isCode = /\.(?:js|mjs|css|html)(?:$|\?)/i.test(url.pathname) || request.mode === 'navigate';
  if (isCode) {
    event.respondWith((async () => {
      try {
        return await fetch(request, { cache:'no-store' });
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match(BASE);
          if (shell) return shell;
        }
        throw new Error('Offline');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error('Offline');
    }
  })());
});

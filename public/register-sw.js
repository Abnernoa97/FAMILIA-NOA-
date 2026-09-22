if ('serviceWorker' in navigator) {
  let refreshing = false;
  const root = location.pathname.startsWith('/FAMILIA-NOA-/') ? '/FAMILIA-NOA-/' : '/';

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(root + 'service-worker.js', {
        scope: root,
        updateViaCache: 'none'
      });
      await registration.update();
    } catch {}
  });
}

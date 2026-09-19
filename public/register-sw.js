if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/FAMILIA-NOA-/service-worker.js', {
        scope: '/FAMILIA-NOA-/',
        updateViaCache: 'none'
      });
      await registration.update();
    } catch (error) {
      console.error('Service worker update failed', error);
    }
  });
}

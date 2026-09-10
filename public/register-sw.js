if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/FAMILIA-NOA-/service-worker.js', { scope: '/FAMILIA-NOA-/' }).catch(() => {});
  });
}

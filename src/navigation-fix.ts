// FAMILIA NOA: ensure album back button returns to the real home screen.
document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  const back = target?.closest('#albumsBack')
  if (!back) return
  event.preventDefault()
  event.stopImmediatePropagation()
  window.location.href = '/FAMILIA-NOA-/'
}, true)

// FAMILIA NOA: native Back closes profile overlays before leaving the app.
const PROFILE_STATE = 'familia-noa-profile-level'
let seenMenu: Element | null = null
let seenDetail: Element | null = null

function pushProfileState(level: number) {
  if (history.state?.[PROFILE_STATE] === level) return
  history.pushState({ ...(history.state || {}), [PROFILE_STATE]: level }, '', location.href)
}

function syncProfileHistory() {
  const menu = document.querySelector('.profile-menu')
  const detail = document.querySelector('.profile-detail')
  if (menu && menu !== seenMenu) { seenMenu = menu; pushProfileState(1) }
  if (detail && detail !== seenDetail) { seenDetail = detail; pushProfileState(2) }
  if (!menu) seenMenu = null
  if (!detail) seenDetail = null
}

window.addEventListener('popstate', () => {
  const level = history.state?.[PROFILE_STATE]
  if (level === 2) { document.querySelector('.profile-detail')?.remove(); return }
  if (level === 1) { if (document.querySelector('.profile-detail')) document.querySelector('.profile-detail')?.remove(); return }
  document.querySelector('.profile-detail')?.remove()
  document.querySelector('.profile-menu')?.remove()
})

document.addEventListener('click', event => {
  const target = event.target as Element | null
  if (!target?.closest('.profile-close, .profile-back')) return
  const level = history.state?.[PROFILE_STATE]
  if (level === 1 || level === 2) setTimeout(() => history.back(), 0)
}, true)

const observer = new MutationObserver(syncProfileHistory)
observer.observe(document.body, { childList: true, subtree: true })
syncProfileHistory()

// Album back button: return to the real home screen without forcing a URL reload.
document.addEventListener('click', event => {
  const target = event.target as Element | null
  if (!target?.closest('#albumsBack')) return
  event.preventDefault()
  event.stopImmediatePropagation()
  window.dispatchEvent(new CustomEvent('familia-home'))
}, true)

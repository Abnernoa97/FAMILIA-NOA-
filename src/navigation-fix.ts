// FAMILIA NOA — one native Back stack for app views and overlays.
const PROFILE_STATE = 'familia-noa-profile-level'
const CHAT_STATE = 'familia-noa-chat-level'
const CHAT_IMAGE_STATE = 'familia-noa-chat-image'
const PHOTOS_STATE = 'familia-noa-photos-level'
const PHOTO_VIEWER_STATE = 'familia-noa-photo-viewer'

function pushStateFlag(key:string, value:string|number|boolean) {
  if (history.state?.[key] === value) return
  history.pushState({ ...(history.state || {}), [key]:value }, '', location.href)
}

function closeChatImage() {
  document.querySelector<HTMLElement>('.chat-image-close')?.click()
}
function closeFamilyPhotoViewer() {
  const viewer = document.querySelector<HTMLElement>('#familyPhotoViewer')
  if (viewer && !viewer.hidden) viewer.querySelector<HTMLButtonElement>('.family-photo-close')?.click()
}

window.addEventListener('popstate', () => {
  // Native Back always closes the deepest visible layer first.
  if (document.querySelector('.chat-image-viewer')) { closeChatImage(); return }
  const photoViewer = document.querySelector<HTMLElement>('#familyPhotoViewer')
  if (photoViewer && !photoViewer.hidden) { closeFamilyPhotoViewer(); return }

  const photoPage = document.querySelector('[data-photo-page]')
  if (photoPage) {
    const albumBack = document.querySelector<HTMLButtonElement>('#albumBack')
    if (albumBack) { albumBack.click(); return }
    const albumsBack = document.querySelector<HTMLButtonElement>('#albumsBack')
    if (albumsBack) { albumsBack.click(); return }
    window.dispatchEvent(new CustomEvent('familia-home'))
    return
  }

  const level = history.state?.[PROFILE_STATE]
  if (level === 2) { document.querySelector('.profile-detail')?.remove(); return }
  if (level === 1) { document.querySelector('.profile-detail')?.remove(); document.querySelector('.profile-menu')?.remove(); return }

  const chatBack = document.querySelector<HTMLButtonElement>('.chat-page #back')
  if (chatBack) { chatBack.click(); return }

  document.querySelector('.profile-detail')?.remove()
  document.querySelector('.profile-menu')?.remove()
})

document.addEventListener('click', event => {
  const target = event.target as Element | null
  if (!target) return

  if (target.closest('[data-chat-image]')) { pushStateFlag(CHAT_IMAGE_STATE, true); return }
  if (target.closest('[data-photo-index]')) { pushStateFlag(PHOTO_VIEWER_STATE, true); return }
  if (target.closest('[data-album-id]')) { pushStateFlag(PHOTOS_STATE, 2); return }
  if (target.closest('#photos, #navphotos')) {
    // Keep a guaranteed in-app home entry below the Albums view. This prevents
    // Android hardware Back from leaving the PWA when Photos is the first
    // navigated screen in the current browser history.
    const base = { ...(history.state || {}), [PHOTOS_STATE]:0 }
    history.replaceState(base, '', location.href)
    history.pushState({ ...base, [PHOTOS_STATE]:1 }, '', location.href)
    return
  }
  if (target.closest('#chat, #navchat')) { pushStateFlag(CHAT_STATE, true); return }
  if (target.closest('#change')) { pushStateFlag(PROFILE_STATE, 1); return }
  if (target.closest('[data-profile-id]')) { pushStateFlag(PROFILE_STATE, 2); return }

  // Visible in-app Back controls consume their matching history entry so
  // hardware Back and UI Back always describe the same navigation stack.
  if (target.closest('.chat-image-close, .family-photo-close, #albumBack, #albumsBack, .profile-close, .profile-back')) {
    setTimeout(() => {
      const state = history.state || {}
      if (state[CHAT_IMAGE_STATE] || state[PHOTO_VIEWER_STATE] || state[PHOTOS_STATE] || state[PROFILE_STATE]) history.back()
    }, 0)
    return
  }
  if (target.closest('.chat-page #back') && history.state?.[CHAT_STATE]) {
    history.replaceState({ ...(history.state || {}), [CHAT_STATE]:false }, '', location.href)
  }
}, true)

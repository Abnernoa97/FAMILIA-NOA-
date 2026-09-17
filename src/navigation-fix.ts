// FAMILIA NOA: native Back closes profile overlays and Chat before leaving the app.
const PROFILE_STATE = 'familia-noa-profile-level'
const CHAT_STATE = 'familia-noa-chat-level'

function pushProfileState(level: number) {
  if (history.state?.[PROFILE_STATE] === level) return
  history.pushState({ ...(history.state || {}), [PROFILE_STATE]: level }, '', location.href)
}

function pushChatState() {
  if (history.state?.[CHAT_STATE]) return
  history.pushState({ ...(history.state || {}), [CHAT_STATE]: true }, '', location.href)
}

window.addEventListener('popstate', () => {
  const level = history.state?.[PROFILE_STATE]
  if (level === 2) { document.querySelector('.profile-detail')?.remove(); return }
  if (level === 1) { document.querySelector('.profile-detail')?.remove(); document.querySelector('.profile-menu')?.remove(); return }

  if (history.state?.[CHAT_STATE]) {
    document.querySelector<HTMLButtonElement>('.chat-page #back')?.click()
    return
  }

  document.querySelector('.profile-detail')?.remove()
  document.querySelector('.profile-menu')?.remove()
})

document.addEventListener('click', event => {
  const target = event.target as Element | null
  if (target?.closest('#chat, #navchat')) {
    pushChatState()
    return
  }
  if (target?.closest('#change')) {
    pushProfileState(1)
    return
  }
  if (target?.closest('[data-profile-id]')) {
    pushProfileState(2)
    return
  }
  if (target?.closest('.profile-close, .profile-back')) {
    const level = history.state?.[PROFILE_STATE]
    if (level === 1 || level === 2) setTimeout(() => history.back(), 0)
    return
  }
  if (target?.closest('.chat-page #back')) {
    if (history.state?.[CHAT_STATE]) {
      history.replaceState({ ...(history.state || {}), [CHAT_STATE]: false }, '', location.href)
    }
  }
}, true)

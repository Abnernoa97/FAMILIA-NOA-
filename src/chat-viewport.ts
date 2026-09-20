let cleanupActiveChat: (() => void) | null = null

function isNearBottom(list: HTMLElement) {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 180
}

function bindChatViewport(page: HTMLElement) {
  const list = page.querySelector<HTMLElement>('#messages')
  const input = page.querySelector<HTMLInputElement>('#message')
  const composer = page.querySelector<HTMLFormElement>('#composer')
  if (!list || !input || !composer) return () => {}

  let stickToLatest = true
  let initialPositioned = false
  let listObserver: MutationObserver | null = null

  // The old floating arrow is no longer part of Chat.
  page.querySelector('#chatTop')?.remove()

  const jumpLatest = () => {
    if (!list.isConnected) return
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
  }

  const revealAtLatest = () => {
    if (initialPositioned) return
    if (!list.querySelector('.bubble, .empty')) return

    jumpLatest()
    requestAnimationFrame(() => {
      if (!list.isConnected) return
      jumpLatest()
      initialPositioned = true
      stickToLatest = true
      list.classList.add('chat-ready')
    })
  }

  const updateViewport = () => {
    if (!page.isConnected) return
    const viewport = window.visualViewport
    const height = Math.max(1, Math.round(viewport?.height || window.innerHeight))
    const top = Math.max(0, Math.round(viewport?.offsetTop || 0))
    page.style.setProperty('--chat-viewport-height', `${height}px`)
    page.style.setProperty('--chat-viewport-top', `${top}px`)

    if (document.activeElement === input || stickToLatest) {
      requestAnimationFrame(jumpLatest)
    }
  }

  listObserver = new MutationObserver(() => {
    if (!initialPositioned) {
      revealAtLatest()
      return
    }
    if (stickToLatest || document.activeElement === input) {
      requestAnimationFrame(jumpLatest)
    }
  })
  listObserver.observe(list, { childList: true, subtree: true })
  revealAtLatest()

  const onScroll = () => {
    if (!initialPositioned) return
    stickToLatest = isNearBottom(list)
  }
  list.addEventListener('scroll', onScroll, { passive: true })

  const onFocus = () => {
    stickToLatest = true
    requestAnimationFrame(jumpLatest)
  }
  input.addEventListener('focus', onFocus)

  const onSubmit = () => {
    stickToLatest = true
    requestAnimationFrame(jumpLatest)
  }
  composer.addEventListener('submit', onSubmit, { capture: true })

  const onChatMessage = (event: Event) => {
    const detail = (event as CustomEvent<{ type?: string }>).detail
    if (detail?.type !== 'insert') return
    if (stickToLatest || document.activeElement === input) {
      requestAnimationFrame(jumpLatest)
    }
  }
  window.addEventListener('familia-noa:chat-message', onChatMessage)

  const viewport = window.visualViewport
  viewport?.addEventListener('resize', updateViewport)
  viewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  window.addEventListener('orientationchange', updateViewport)
  updateViewport()

  return () => {
    listObserver?.disconnect()
    listObserver = null
    list.removeEventListener('scroll', onScroll)
    input.removeEventListener('focus', onFocus)
    composer.removeEventListener('submit', onSubmit, { capture: true })
    window.removeEventListener('familia-noa:chat-message', onChatMessage)
    viewport?.removeEventListener('resize', updateViewport)
    viewport?.removeEventListener('scroll', updateViewport)
    window.removeEventListener('resize', updateViewport)
    window.removeEventListener('orientationchange', updateViewport)
    list.classList.remove('chat-ready')
  }
}

function syncChatPage() {
  const page = document.querySelector<HTMLElement>('.chat-page')
  if (!page) {
    cleanupActiveChat?.()
    cleanupActiveChat = null
    return
  }
  if (page.dataset.viewportController === '1') return

  cleanupActiveChat?.()
  cleanupActiveChat = null
  page.dataset.viewportController = '1'
  cleanupActiveChat = bindChatViewport(page)
}

const app = document.querySelector('#app')
const pageObserver = new MutationObserver(syncChatPage)
if (app) pageObserver.observe(app, { childList: true })
syncChatPage()

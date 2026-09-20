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
  let forceLatestUntil = 0
  let revealTimer: number | null = null
  let listObserver: MutationObserver | null = null

  const scrollLatest = (behavior: ScrollBehavior = 'auto') => {
    if (!list.isConnected) return
    stickToLatest = true
    if (behavior === 'smooth') list.scrollTo({ top: list.scrollHeight, behavior })
    else list.scrollTop = list.scrollHeight
  }

  const updateViewport = () => {
    if (!page.isConnected) return
    const viewport = window.visualViewport
    const height = Math.max(1, Math.round(viewport?.height || window.innerHeight))
    const top = Math.max(0, Math.round(viewport?.offsetTop || 0))
    page.style.setProperty('--chat-viewport-height', `${height}px`)
    page.style.setProperty('--chat-viewport-top', `${top}px`)

    if (document.activeElement === input || stickToLatest) {
      requestAnimationFrame(() => scrollLatest())
    }
  }

  const revealDirectlyAtLatest = () => {
    if (!list.querySelector('.bubble')) return
    list.classList.add('chat-positioning')
    listObserver?.disconnect()
    listObserver = null
    if (revealTimer) window.clearTimeout(revealTimer)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        revealTimer = window.setTimeout(() => {
          if (!list.isConnected) return
          scrollLatest()
          list.classList.remove('chat-positioning')
        }, 160)
      })
    })
  }

  listObserver = new MutationObserver(() => revealDirectlyAtLatest())
  listObserver.observe(list, { childList: true })
  if (list.querySelector('.bubble')) revealDirectlyAtLatest()

  const oldButton = page.querySelector<HTMLButtonElement>('#chatTop')
  let latestButton: HTMLButtonElement | null = null
  if (oldButton) {
    latestButton = oldButton.cloneNode(true) as HTMLButtonElement
    latestButton.textContent = '↓'
    latestButton.setAttribute('aria-label', 'Ir al último mensaje')
    latestButton.title = 'Ir al último mensaje'
    oldButton.replaceWith(latestButton)
  }

  const onLatestClick = () => scrollLatest('smooth')
  latestButton?.addEventListener('click', onLatestClick)

  const onScroll = () => {
    stickToLatest = isNearBottom(list)
  }
  list.addEventListener('scroll', onScroll, { passive: true })

  const onFocus = () => {
    stickToLatest = true
    requestAnimationFrame(() => scrollLatest())
    window.setTimeout(() => scrollLatest(), 80)
    window.setTimeout(() => scrollLatest(), 220)
  }
  input.addEventListener('focus', onFocus)

  const onSubmit = () => {
    stickToLatest = true
    forceLatestUntil = performance.now() + 2500
    requestAnimationFrame(() => scrollLatest())
  }
  composer.addEventListener('submit', onSubmit, { capture: true })

  const onChatMessage = (event: Event) => {
    const detail = (event as CustomEvent<{ type?: string }>).detail
    if (detail?.type !== 'insert') return
    if (stickToLatest || performance.now() < forceLatestUntil) {
      requestAnimationFrame(() => scrollLatest())
      window.setTimeout(() => scrollLatest(), 80)
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
    if (revealTimer) window.clearTimeout(revealTimer)
    listObserver?.disconnect()
    listObserver = null
    latestButton?.removeEventListener('click', onLatestClick)
    list.removeEventListener('scroll', onScroll)
    input.removeEventListener('focus', onFocus)
    composer.removeEventListener('submit', onSubmit, { capture: true })
    window.removeEventListener('familia-noa:chat-message', onChatMessage)
    viewport?.removeEventListener('resize', updateViewport)
    viewport?.removeEventListener('scroll', updateViewport)
    window.removeEventListener('resize', updateViewport)
    window.removeEventListener('orientationchange', updateViewport)
    list.classList.remove('chat-positioning')
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

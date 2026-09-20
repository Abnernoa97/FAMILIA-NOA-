let activeList: HTMLElement | null = null
let listObserver: MutationObserver | null = null
let pageObserver: MutationObserver | null = null
let cleanupTimer: number | null = null
let hydrationStarted = false
let stickUntil = 0
let interrupted = false
let scanScheduled = false

function clearListState() {
  listObserver?.disconnect()
  listObserver = null
  if (cleanupTimer) window.clearTimeout(cleanupTimer)
  cleanupTimer = null
  activeList = null
  hydrationStarted = false
  stickUntil = 0
  interrupted = false
}

function forceLatest(behavior: ScrollBehavior = 'auto') {
  const list = activeList || document.querySelector<HTMLElement>('.chat-page #messages')
  if (!list) return
  if (behavior === 'smooth') list.scrollTo({ top: list.scrollHeight, behavior })
  else list.scrollTop = list.scrollHeight
}

function scrollToLatest() {
  const list = activeList
  if (!list || interrupted || !hydrationStarted || performance.now() > stickUntil) return
  requestAnimationFrame(() => {
    if (!activeList || activeList !== list || interrupted) return
    list.scrollTop = list.scrollHeight
  })
}

function startHydrationWindow() {
  if (!activeList || hydrationStarted) return
  hydrationStarted = true
  stickUntil = performance.now() + 4500
  forceLatest()
  ;[40, 100, 180, 320, 520, 800, 1200, 1700, 2300, 3000, 3800, 4450].forEach(delay => {
    window.setTimeout(scrollToLatest, delay)
  })
  cleanupTimer = window.setTimeout(() => {
    listObserver?.disconnect()
    listObserver = null
  }, 4800)
}

function bindLatestButton() {
  const button = document.querySelector<HTMLButtonElement>('.chat-page #chatTop')
  if (!button || button.dataset.latestBound === '1') return

  // Mark first so changing textContent cannot create a MutationObserver feedback loop.
  button.dataset.latestBound = '1'
  if (button.textContent !== '↓') button.textContent = '↓'
  button.setAttribute('aria-label', 'Ir al último mensaje')
  button.title = 'Ir al último mensaje'
  button.addEventListener('click', event => {
    event.preventDefault()
    event.stopImmediatePropagation()
    interrupted = true
    forceLatest('smooth')
  }, { capture: true })
}

function bindList(list: HTMLElement) {
  if (activeList === list) {
    bindLatestButton()
    return
  }
  clearListState()
  activeList = list
  bindLatestButton()

  const interrupt = () => {
    interrupted = true
    listObserver?.disconnect()
    listObserver = null
  }

  list.addEventListener('touchstart', interrupt, { passive: true, once: true })
  list.addEventListener('wheel', interrupt, { passive: true, once: true })
  list.addEventListener('pointerdown', interrupt, { passive: true, once: true })
  list.addEventListener('load', event => {
    if ((event.target as Element | null)?.tagName === 'IMG') scrollToLatest()
  }, true)

  listObserver = new MutationObserver(() => {
    if (!hydrationStarted && list.querySelector('.bubble')) startHydrationWindow()
    scrollToLatest()
  })
  listObserver.observe(list, { childList: true, subtree: true })

  if (list.querySelector('.bubble')) startHydrationWindow()
  else requestAnimationFrame(() => forceLatest())
}

function scan() {
  const list = document.querySelector<HTMLElement>('.chat-page #messages')
  if (list) {
    bindList(list)
    return
  }
  if (activeList) clearListState()
}

function scheduleScan() {
  if (scanScheduled) return
  scanScheduled = true
  requestAnimationFrame(() => {
    scanScheduled = false
    scan()
  })
}

pageObserver = new MutationObserver(scheduleScan)
pageObserver.observe(document.body, { childList: true, subtree: true })
scan()

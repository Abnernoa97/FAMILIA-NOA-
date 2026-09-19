let activeList: HTMLElement | null = null
let listObserver: MutationObserver | null = null
let pageObserver: MutationObserver | null = null
let cleanupTimer: number | null = null
let hydrationStarted = false
let stickUntil = 0
let interrupted = false

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
  stickUntil = performance.now() + 2800
  scrollToLatest()
  ;[60, 140, 280, 520, 900, 1400, 2100, 2700].forEach(delay => {
    window.setTimeout(scrollToLatest, delay)
  })
  cleanupTimer = window.setTimeout(() => {
    listObserver?.disconnect()
    listObserver = null
  }, 3100)
}

function bindList(list: HTMLElement) {
  if (activeList === list) return
  clearListState()
  activeList = list

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
}

function scan() {
  const list = document.querySelector<HTMLElement>('.chat-page #messages')
  if (list) {
    bindList(list)
    return
  }
  if (activeList) clearListState()
}

pageObserver = new MutationObserver(scan)
pageObserver.observe(document.body, { childList: true, subtree: true })
scan()

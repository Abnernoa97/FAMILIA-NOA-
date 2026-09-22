export function bindChatViewport(
  page: HTMLElement,
  list: HTMLElement,
  input: HTMLInputElement,
  isSticky: () => boolean,
  scrollLatest: () => void
) {
  let frame = 0
  const viewport = window.visualViewport

  const scheduleLatest = (force = false) => {
    if (!page.isConnected) return
    if (!force && !isSticky() && document.activeElement !== input) return
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      if (!page.isConnected) return
      if (force || isSticky() || document.activeElement === input) scrollLatest()
    })
  }

  const updateViewport = () => {
    if (!page.isConnected) return
    const height = Math.max(1, Math.round(viewport?.height || window.innerHeight))
    const top = Math.max(0, Math.round(viewport?.offsetTop || 0))
    page.style.setProperty('--chat-vh', `${height}px`)
    page.style.setProperty('--chat-vtop', `${top}px`)
    scheduleLatest()
  }

  const onFocus = () => scheduleLatest(true)

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => scheduleLatest())
    : null

  const observeNode = (node: Node) => {
    if (!resizeObserver || !(node instanceof HTMLElement)) return
    if (node.matches('.chat-bubble')) resizeObserver.observe(node)
    node.querySelectorAll<HTMLElement>('.chat-bubble').forEach(element => resizeObserver.observe(element))
  }

  const unobserveNode = (node: Node) => {
    if (!resizeObserver || !(node instanceof HTMLElement)) return
    if (node.matches('.chat-bubble')) resizeObserver.unobserve(node)
    node.querySelectorAll<HTMLElement>('.chat-bubble').forEach(element => resizeObserver.unobserve(element))
  }

  const mutationObserver = resizeObserver
    ? new MutationObserver(records => {
        records.forEach(record => {
          record.addedNodes.forEach(observeNode)
          record.removedNodes.forEach(unobserveNode)
        })
      })
    : null

  observeNode(list)
  mutationObserver?.observe(list, { childList: true, subtree: true })

  viewport?.addEventListener('resize', updateViewport)
  viewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
  window.addEventListener('orientationchange', updateViewport)
  input.addEventListener('focus', onFocus)
  updateViewport()

  return () => {
    if (frame) cancelAnimationFrame(frame)
    mutationObserver?.disconnect()
    resizeObserver?.disconnect()
    viewport?.removeEventListener('resize', updateViewport)
    viewport?.removeEventListener('scroll', updateViewport)
    window.removeEventListener('resize', updateViewport)
    window.removeEventListener('orientationchange', updateViewport)
    input.removeEventListener('focus', onFocus)
  }
}

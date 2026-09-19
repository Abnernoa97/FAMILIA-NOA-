let viewer: HTMLElement | null = null
let previousOverflow = ''

function closeViewer() {
  if (!viewer) return
  viewer.remove()
  viewer = null
  document.body.style.overflow = previousOverflow
}

function openViewer(src: string, alt: string) {
  closeViewer()
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  viewer = document.createElement('div')
  viewer.className = 'chat-photo-viewer'
  viewer.setAttribute('role', 'dialog')
  viewer.setAttribute('aria-modal', 'true')
  viewer.innerHTML = `
    <button class="chat-photo-viewer-close" aria-label="Cerrar">×</button>
    <img src="${src}" alt="${alt || 'Foto'}">
  `
  document.body.appendChild(viewer)
  viewer.querySelector('.chat-photo-viewer-close')?.addEventListener('click', closeViewer)
  viewer.addEventListener('click', e => { if (e.target === viewer) closeViewer() })
  history.pushState({ ...(history.state || {}), chatPhotoViewer: true }, '')
}

document.addEventListener('click', e => {
  const target = e.target as HTMLElement | null
  const attachment = target?.closest<HTMLAnchorElement>('.chat-page .chat-attachment')
  const image = attachment?.querySelector<HTMLImageElement>('img')
  if (!attachment || !image) return
  e.preventDefault()
  e.stopPropagation()
  openViewer(image.currentSrc || image.src, image.alt)
}, true)

window.addEventListener('popstate', () => {
  if (viewer) closeViewer()
})

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && viewer) closeViewer()
})

const style = document.createElement('style')
style.textContent = `
.chat-photo-viewer{position:fixed;inset:0;z-index:9999;background:#090909;display:grid;place-items:center;padding:0;touch-action:pan-x pan-y}
.chat-photo-viewer img{display:block;width:100%;height:100%;max-width:100vw;max-height:100dvh;object-fit:contain}
.chat-photo-viewer-close{position:absolute;top:max(14px,env(safe-area-inset-top));left:14px;z-index:2;width:42px;height:42px;border-radius:50%;background:#1b1b1bcc;color:#fff;font:300 30px/1 sans-serif;display:grid;place-items:center;backdrop-filter:blur(8px)}
.chat-page .chat-attachment>span{display:none!important}
.chat-page .quoted>span:empty{display:none}
`
document.head.appendChild(style)

function cleanPhotoReplyLabels() {
  document.querySelectorAll<HTMLElement>('.chat-page .quoted > span').forEach(el => {
    const text = (el.textContent || '').trim()
    if ((text === '📷 Foto' || text === 'Foto') && el.parentElement?.querySelector('.chat-reply-thumb')) {
      el.textContent = ''
      el.style.display = 'none'
    }
  })
}

new MutationObserver(cleanPhotoReplyLabels).observe(document.body, { childList: true, subtree: true })
cleanPhotoReplyLabels()

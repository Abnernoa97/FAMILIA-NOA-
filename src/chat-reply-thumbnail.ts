import { supabase } from './supabase'

let lastReplySourceId = ''
let observer: MutationObserver | null = null
const resolving = new Set<string>()

function installStyle() {
  if (document.getElementById('chat-reply-thumbnail-style')) return
  const style = document.createElement('style')
  style.id = 'chat-reply-thumbnail-style'
  style.textContent = `
    .quoted.has-reply-thumb{position:relative;min-height:56px;padding-right:64px}
    .quoted .chat-reply-thumb{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:8px;object-fit:cover;background:#ddd8cf;box-shadow:0 1px 5px #0001}
    .reply-preview>div.has-reply-thumb{position:relative;min-height:58px;padding-right:66px}
    .reply-preview .chat-reply-thumb{position:absolute;right:7px;top:50%;transform:translateY(-50%);width:46px;height:46px;border-radius:8px;object-fit:cover;background:#ddd8cf;box-shadow:0 1px 5px #0001}
  `
  document.head.appendChild(style)
}

function sourceBubble(id: string) {
  if (!id) return null
  return document.querySelector<HTMLElement>(`.bubble[data-message-id="${CSS.escape(id)}"]`)
}

function imageFromBubble(bubble: HTMLElement | null) {
  return bubble?.querySelector<HTMLImageElement>('.chat-attachment img, .chat-pending-media img')?.src || ''
}

function applyThumb(container: HTMLElement, src: string) {
  if (!src) return
  let image = container.querySelector<HTMLImageElement>('.chat-reply-thumb')
  if (!image) {
    image = document.createElement('img')
    image.className = 'chat-reply-thumb'
    image.alt = 'Foto respondida'
    image.loading = 'lazy'
    container.appendChild(image)
  }
  if (image.src !== src) image.src = src
  container.classList.add('has-reply-thumb')
}

async function resolveMessageThumb(messageId: string, target: HTMLElement) {
  if (!messageId || resolving.has(messageId) || target.querySelector('.chat-reply-thumb')) return
  const local = imageFromBubble(sourceBubble(messageId))
  if (local) {
    applyThumb(target, local)
    return
  }
  resolving.add(messageId)
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('attachment_path,attachment_type,deleted_at')
      .eq('id', messageId)
      .maybeSingle()
    if (error || !data?.attachment_path || data.deleted_at || !(data.attachment_type || '').startsWith('image/')) return
    const src = supabase.storage.from('family-photos').getPublicUrl(data.attachment_path).data.publicUrl
    if (src && target.isConnected) applyThumb(target, src)
  } finally {
    resolving.delete(messageId)
  }
}

function syncQuoted() {
  document.querySelectorAll<HTMLElement>('.chat-page .quoted[data-jump]').forEach(quoted => {
    const id = quoted.dataset.jump || ''
    void resolveMessageThumb(id, quoted)
  })
}

function syncPreview() {
  const preview = document.querySelector<HTMLElement>('.chat-page .reply-preview')
  const box = preview?.querySelector<HTMLElement>(':scope > div')
  if (!preview || !box || !lastReplySourceId) return
  void resolveMessageThumb(lastReplySourceId, box)
}

function syncAll() {
  if (!document.querySelector('.chat-page')) return
  installStyle()
  syncQuoted()
  syncPreview()
}

function rememberReplySource(target: EventTarget | null) {
  const element = target as HTMLElement | null
  const bubble = element?.closest<HTMLElement>('.chat-page .bubble[data-message-id]')
  if (!bubble) return
  lastReplySourceId = bubble.dataset.messageId || ''
  window.setTimeout(syncPreview, 0)
  window.setTimeout(syncPreview, 80)
}

document.addEventListener('click', event => {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-reply-action]')) rememberReplySource(target)
  if (target?.closest('#cancelReply')) lastReplySourceId = ''
}, true)

document.addEventListener('dblclick', event => rememberReplySource(event.target), true)
document.addEventListener('touchend', event => {
  const target = event.target as HTMLElement | null
  if (target?.closest('.chat-page .bubble[data-message-id]')) rememberReplySource(target)
}, { capture: true, passive: true })

observer = new MutationObserver(syncAll)
observer.observe(document.body, { childList: true, subtree: true })
syncAll()

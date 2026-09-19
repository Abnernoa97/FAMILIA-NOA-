import { supabase } from './supabase'
import { getIdentity } from './core/identity'

type ChatEventDetail = { type?: string; id?: string; sender_id?: string }

const cleanupInFlight = new Set<string>()

const currentMemberId = () => getIdentity()?.memberId || ''

function installStyle() {
  if (document.getElementById('chat-message-actions-style')) return
  const style = document.createElement('style')
  style.id = 'chat-message-actions-style'
  style.textContent = `
    .chat-tools [data-reply-action]{font-weight:600}
    .chat-reply-flash{animation:chatReplyFlash 1.1s ease}
    @keyframes chatReplyFlash{0%,100%{box-shadow:0 3px 14px #2b261508}35%{box-shadow:0 0 0 4px #17171622,0 3px 14px #2b261508}}
  `
  document.head.appendChild(style)
}

function replyLabelForBubble(bubble: HTMLElement | null) {
  if (!bubble) return 'Mensaje'
  if (bubble.querySelector('.chat-attachment, .chat-pending-media')) return '📷 Foto'
  const body = bubble.querySelector('p')?.textContent?.trim()
  return body || 'Mensaje'
}

function normalizeReplyPreview(sourceBubble?: HTMLElement | null) {
  const preview = document.querySelector<HTMLElement>('.reply-preview')
  if (!preview) return
  const text = preview.querySelector<HTMLElement>('span')
  if (!text || text.textContent?.trim()) return
  text.textContent = replyLabelForBubble(sourceBubble || null)
}

function normalizeQuotedMessages() {
  document.querySelectorAll<HTMLElement>('.chat-page .quoted[data-jump]').forEach(quoted => {
    const text = quoted.querySelector<HTMLElement>('span')
    if (!text || text.textContent?.trim()) return
    const id = quoted.dataset.jump || ''
    const target = id ? document.querySelector<HTMLElement>(`.bubble[data-message-id="${id}"]`) : null
    text.textContent = replyLabelForBubble(target)
  })
}

function triggerReply(bubble: HTMLElement) {
  if (bubble.querySelector('p')?.textContent?.trim() === 'Mensaje eliminado') return
  bubble.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
  requestAnimationFrame(() => {
    normalizeReplyPreview(bubble)
    document.querySelector<HTMLInputElement>('#message')?.focus()
  })
}

function addReplyButtons() {
  document.querySelectorAll<HTMLElement>('.chat-page .bubble[data-message-id]').forEach(bubble => {
    if (bubble.querySelector('p')?.textContent?.trim() === 'Mensaje eliminado') return
    const tools = bubble.querySelector<HTMLElement>('.chat-tools')
    if (!tools || tools.querySelector('[data-reply-action]')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.replyAction = '1'
    button.textContent = '↩ Responder'
    button.setAttribute('aria-label', 'Responder mensaje')
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      triggerReply(bubble)
    })
    tools.insertBefore(button, tools.firstChild)
  })
}

function scanChatActions() {
  if (!document.querySelector('.chat-page')) return
  installStyle()
  addReplyButtons()
  normalizeQuotedMessages()
}

function scheduleScan() {
  ;[0, 60, 180, 450, 900, 1500].forEach(delay => window.setTimeout(scanChatActions, delay))
}

async function cleanupDeletedAttachment(messageId: string) {
  if (!messageId || cleanupInFlight.has(messageId)) return
  cleanupInFlight.add(messageId)
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('sender_id,deleted_at,attachment_path')
      .eq('id', messageId)
      .maybeSingle()
    if (error || !data?.deleted_at || !data?.attachment_path || data.sender_id !== currentMemberId()) return
    await supabase.storage.from('family-photos').remove([data.attachment_path])
  } catch (error) {
    console.error('Deleted Chat attachment cleanup failed', error)
  } finally {
    cleanupInFlight.delete(messageId)
  }
}

document.addEventListener('click', event => {
  const target = event.target as HTMLElement | null
  if (target?.closest('#chat, #navchat')) scheduleScan()

  const quoted = target?.closest<HTMLElement>('.chat-page .quoted[data-jump]')
  if (quoted) {
    const id = quoted.dataset.jump || ''
    window.setTimeout(() => {
      const bubble = id ? document.querySelector<HTMLElement>(`.bubble[data-message-id="${id}"]`) : null
      if (!bubble) return
      bubble.classList.remove('chat-reply-flash')
      void bubble.offsetWidth
      bubble.classList.add('chat-reply-flash')
      window.setTimeout(() => bubble.classList.remove('chat-reply-flash'), 1200)
    }, 80)
  }
}, true)

document.addEventListener('dblclick', event => {
  const bubble = (event.target as HTMLElement | null)?.closest<HTMLElement>('.chat-page .bubble[data-message-id]')
  if (bubble) requestAnimationFrame(() => normalizeReplyPreview(bubble))
})

document.addEventListener('touchend', event => {
  const bubble = (event.target as HTMLElement | null)?.closest<HTMLElement>('.chat-page .bubble[data-message-id]')
  if (bubble) window.setTimeout(() => normalizeReplyPreview(bubble), 0)
}, { passive: true })

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  const cancel = document.querySelector<HTMLButtonElement>('#cancelReply')
  if (cancel) cancel.click()
})

window.addEventListener('familia-noa:chat-message', event => {
  const detail = (event as CustomEvent<ChatEventDetail>).detail
  scheduleScan()
  if (detail?.type === 'update' && detail.id) void cleanupDeletedAttachment(detail.id)
})

window.addEventListener('popstate', scheduleScan)

scheduleScan()

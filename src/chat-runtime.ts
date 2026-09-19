import { supabase } from './supabase'
import { getIdentity } from './core/identity'

type PresenceMeta = { memberId?: string; name?: string; onlineAt?: string }
type PresenceState = Record<string, PresenceMeta[]>
type PendingPhoto = { bubble: HTMLElement; objectUrl: string }
type ChatEventDetail = { type?: string; id?: string; sender_id?: string }

let chatStarted = false
let featureChannel: ReturnType<typeof supabase.channel> | null = null
let presenceChannel: ReturnType<typeof supabase.channel> | null = null
let homeUnreadChannel: ReturnType<typeof supabase.channel> | null = null
let listObserver: MutationObserver | null = null
let typingStopTimer: number | null = null
let typingExpiryTimer: number | null = null
let unreadRefreshTimer: number | null = null
let readTimer: number | null = null
let chatMessageHandler: ((event: Event) => void) | null = null
let activeList: HTMLElement | null = null
const pendingPhotos = new Map<string, PendingPhoto>()

const identity = () => getIdentity()
const memberId = () => identity()?.memberId || ''
const memberName = () => identity()?.name || 'Familia'
const chatOpen = () => !!document.querySelector('.chat-page')
const chatList = () => document.querySelector<HTMLElement>('#messages')
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))

function installStyle() {
  if (document.getElementById('chat-runtime-style')) return
  const style = document.createElement('style')
  style.id = 'chat-runtime-style'
  style.textContent = `
    .chat-unread-badge{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#171716;color:#fff;font-size:10px;font-weight:700;margin-left:6px;vertical-align:middle}
    .chat-new-indicator{position:sticky;top:6px;z-index:12;align-self:center;background:#171716;color:#fff;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:700;box-shadow:0 8px 24px #0003;cursor:pointer}
    .chat-presence{font-size:11px;color:#77736b;margin-top:3px;min-height:15px}
    .chat-typing{font-size:11px;color:#77736b;text-align:center;min-height:16px;padding:0 14px}
    .chat-tools{display:flex;gap:4px;align-items:center;margin-top:5px;opacity:.82;flex-wrap:wrap}
    .chat-tools button{background:#eeeae2;border-radius:999px;min-width:28px;height:26px;padding:0 7px;font-size:12px}
    .chat-tools [data-reply-action]{font-weight:600}
    .chat-tools .danger{color:#9a3f32}
    .chat-reaction-picker{display:none;gap:4px;flex-wrap:wrap}
    .chat-tools.reactions-open .chat-reaction-picker{display:flex}
    .chat-reaction-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    .chat-reaction{background:#f0ece4;border-radius:999px;padding:3px 7px;font-size:11px}
    .chat-reaction.is-mine{background:#171716;color:#fff}
    .chat-attachment{display:block;margin-top:8px;border-radius:12px;overflow:hidden;background:#e8e3da;text-decoration:none;color:#171716}
    .chat-attachment img{display:block;width:100%;aspect-ratio:4/5;max-height:320px;object-fit:cover;background:#e8e3da}
    .chat-attachment span{display:block;padding:8px 10px;font-size:12px}
    .chat-read-state{font-size:10px;color:#8a867e;margin-left:4px;font-weight:700;letter-spacing:-.08em}
    .chat-edited-state{font-size:10px;color:#8a867e;margin-left:4px}
    .chat-attach-button{width:42px;height:42px;border-radius:50%;background:#fff;border:1px solid #d9d4ca;font-size:19px;flex:0 0 42px;padding:0!important}
    .chat-pending{opacity:.94;min-width:180px}
    .chat-pending-media{margin:-2px -6px 7px;border-radius:12px;overflow:hidden;background:#ded9d0}
    .chat-pending-media img{display:block;width:100%;aspect-ratio:4/5;max-height:320px;object-fit:cover}
    .chat-pending small{display:flex;justify-content:flex-end;align-items:center;gap:6px}
    .chat-upload-spinner{width:11px;height:11px;border:1.5px solid #9a968e;border-top-color:#171716;border-radius:50%;animation:chatSpin .75s linear infinite}
    .chat-upload-error{color:#9a3f32!important}
    .chat-dialog{position:fixed;inset:0;background:#17171655;backdrop-filter:blur(5px);display:flex;align-items:flex-end;z-index:100}
    .chat-dialog-card{background:#f8f5ee;width:100%;max-width:760px;margin:auto;padding:24px;border-radius:28px 28px 0 0}
    .chat-dialog-card h3{font:500 28px 'Playfair Display',serif;margin:0 0 8px}
    .chat-dialog-card textarea{width:100%;min-height:110px;border:1px solid #d9d4ca;border-radius:16px;padding:14px;resize:vertical;background:#fff}
    .chat-dialog-actions{display:flex;gap:8px;margin-top:12px}.chat-dialog-actions button{flex:1;padding:13px;border-radius:14px}.chat-dialog-actions .confirm{background:#171716;color:#fff}
    .chat-reply-flash{animation:chatReplyFlash 1.1s ease}
    @keyframes chatSpin{to{transform:rotate(360deg)}}
    @keyframes chatReplyFlash{0%,100%{box-shadow:0 3px 14px #2b261508}35%{box-shadow:0 0 0 4px #17171622,0 3px 14px #2b261508}}
  `
  document.head.appendChild(style)
}

async function refreshUnread() {
  const id = memberId()
  const card = document.querySelector<HTMLElement>('#chat')
  const nav = document.querySelector<HTMLElement>('#navchat')
  if (!id || (!card && !nav)) return
  const { data, error } = await supabase.rpc('get_chat_unread_count', { p_member_id: id })
  if (error) return
  const count = Number(data || 0)
  document.querySelectorAll('.chat-unread-badge').forEach(el => el.remove())
  if (count <= 0) return
  const text = count > 99 ? '99+' : String(count)
  const label = card?.querySelector('b')
  if (label) label.insertAdjacentHTML('beforeend', `<span class="chat-unread-badge">${text}</span>`)
  if (nav) nav.insertAdjacentHTML('beforeend', `<span class="chat-unread-badge">${text}</span>`)
}

function scheduleUnreadRefresh(delay = 120) {
  if (unreadRefreshTimer) window.clearTimeout(unreadRefreshTimer)
  unreadRefreshTimer = window.setTimeout(() => void refreshUnread(), delay)
}

function startHomeUnreadRealtime() {
  if (homeUnreadChannel || !document.querySelector('.shell') || chatOpen()) return
  homeUnreadChannel = supabase.channel('familia-noa-chat-unread-home')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      if ((payload.new as any)?.sender_id !== memberId()) scheduleUnreadRefresh(50)
    })
    .subscribe()
}

function stopHomeUnreadRealtime() {
  void homeUnreadChannel?.unsubscribe()
  homeUnreadChannel = null
}

function showDialog(title: string, initial: string, onConfirm: (value: string) => Promise<void>) {
  const overlay = document.createElement('div')
  overlay.className = 'chat-dialog'
  overlay.innerHTML = `<div class="chat-dialog-card"><h3>${esc(title)}</h3><textarea id="chatDialogInput">${esc(initial)}</textarea><div class="chat-dialog-actions"><button id="chatDialogCancel">Cancelar</button><button class="confirm" id="chatDialogConfirm">Guardar</button></div></div>`
  document.body.appendChild(overlay)
  const input = overlay.querySelector<HTMLTextAreaElement>('#chatDialogInput')!
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  overlay.querySelector('#chatDialogCancel')!.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove() })
  overlay.querySelector('#chatDialogConfirm')!.addEventListener('click', async () => {
    const value = input.value.trim()
    if (!value) return
    const button = overlay.querySelector<HTMLButtonElement>('#chatDialogConfirm')!
    button.disabled = true
    try { await onConfirm(value); overlay.remove() } finally { button.disabled = false }
  })
}

function setEditedState(bubble: HTMLElement, edited: boolean) {
  const small = bubble.querySelector('small')
  if (!small) return
  small.querySelector('.chat-edited-state')?.remove()
  if (edited) small.insertAdjacentHTML('beforeend', '<span class="chat-edited-state"> · editado</span>')
}

function isAtBottom(list: HTMLElement) {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 120
}

function scheduleMarkRead(delay = 80) {
  if (readTimer) window.clearTimeout(readTimer)
  readTimer = window.setTimeout(() => void markVisibleRead(), delay)
}

async function markVisibleRead() {
  const id = memberId()
  const list = chatList()
  if (!id || !list || document.visibilityState !== 'visible' || !isAtBottom(list)) return
  const ids = Array.from(list.querySelectorAll<HTMLElement>('.bubble:not(.mine)[data-message-id]'))
    .map(el => el.dataset.messageId || '')
    .filter(Boolean)
    .slice(-60)
  const now = new Date().toISOString()
  await supabase.rpc('mark_chat_read', { p_member_id: id, p_read_at: now })
  if (ids.length) {
    await Promise.allSettled(ids.map(messageId => supabase.rpc('mark_chat_message_read', { p_member_id: id, p_message_id: messageId })))
  }
  scheduleUnreadRefresh(0)
  await renderReadReceipts()
}

async function renderReadReceipts() {
  const id = memberId()
  const list = chatList()
  if (!id || !list) return
  const ownIds = Array.from(list.querySelectorAll<HTMLElement>('.bubble.mine[data-message-id]'))
    .map(el => el.dataset.messageId || '')
    .filter(Boolean)
  if (!ownIds.length) return
  const { data, error } = await supabase.rpc('get_chat_read_receipts', { p_message_ids: ownIds })
  if (error) return
  const read = new Set((data || []).filter((row: any) => row.member_id !== id).map((row: any) => row.message_id))
  list.querySelectorAll<HTMLElement>('.bubble.mine[data-message-id]').forEach(bubble => {
    const small = bubble.querySelector('small')
    if (!small) return
    let state = small.querySelector<HTMLElement>('.chat-read-state')
    if (read.has(bubble.dataset.messageId || '')) {
      if (!state) {
        state = document.createElement('span')
        state.className = 'chat-read-state'
        small.appendChild(state)
      }
      state.textContent = ' ✓✓'
      state.setAttribute('aria-label', 'Leído')
      state.title = 'Leído'
    } else {
      state?.remove()
    }
  })
}

async function toggleReaction(messageId: string, reaction: string) {
  const id = memberId()
  if (!id) return
  const { error } = await supabase.rpc('toggle_chat_reaction', { p_member_id: id, p_message_id: messageId, p_reaction: reaction })
  if (!error) await renderReactions(messageId)
}

async function renderReactions(messageId: string) {
  const bubble = document.querySelector<HTMLElement>(`.bubble[data-message-id="${messageId}"]`)
  if (!bubble) return
  const { data, error } = await supabase.from('chat_reactions').select('member_id,reaction').eq('message_id', messageId)
  if (error) return
  const rows = data || []
  const existing = bubble.querySelector<HTMLElement>('.chat-reaction-row')
  if (!rows.length) { existing?.remove(); return }
  const row = existing || document.createElement('div')
  row.className = 'chat-reaction-row'
  const counts = new Map<string, number>()
  const mine = new Set<string>()
  for (const item of rows as any[]) {
    counts.set(item.reaction, (counts.get(item.reaction) || 0) + 1)
    if (item.member_id === memberId()) mine.add(item.reaction)
  }
  row.innerHTML = Array.from(counts.entries()).map(([reaction, count]) => `<button type="button" class="chat-reaction${mine.has(reaction) ? ' is-mine' : ''}" data-react="${esc(reaction)}" aria-pressed="${mine.has(reaction)}">${reaction} ${count}</button>`).join('')
  row.querySelectorAll<HTMLButtonElement>('[data-react]').forEach(button => {
    button.addEventListener('click', () => void toggleReaction(messageId, button.dataset.react || ''))
  })
  if (!existing) bubble.appendChild(row)
}

function replyLabelForBubble(bubble: HTMLElement | null) {
  if (!bubble) return 'Mensaje'
  if (bubble.querySelector('.chat-attachment, .chat-pending-media')) return '📷 Foto'
  return bubble.querySelector('p')?.textContent?.trim() || 'Mensaje'
}

function normalizeReplyPreview(sourceBubble?: HTMLElement | null) {
  const preview = document.querySelector<HTMLElement>('.reply-preview')
  if (!preview) return
  const text = preview.querySelector<HTMLElement>('span')
  if (!text || text.textContent?.trim()) return
  text.textContent = replyLabelForBubble(sourceBubble || null)
}

function normalizeQuoted(quoted: HTMLElement) {
  const text = quoted.querySelector<HTMLElement>('span')
  if (!text || text.textContent?.trim()) return
  const id = quoted.dataset.jump || ''
  const source = id ? document.querySelector<HTMLElement>(`.bubble[data-message-id="${id}"]`) : null
  text.textContent = replyLabelForBubble(source)
}

function triggerReply(bubble: HTMLElement) {
  if (bubble.querySelector('p')?.textContent?.trim() === 'Mensaje eliminado') return
  bubble.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }))
  requestAnimationFrame(() => {
    normalizeReplyPreview(bubble)
    document.querySelector<HTMLInputElement>('#message')?.focus()
  })
}

async function deleteMessage(bubble: HTMLElement, messageId: string) {
  if (!confirm('¿Eliminar este mensaje?')) return
  const { data: message } = await supabase.from('messages').select('attachment_path').eq('id', messageId).maybeSingle()
  const { data, error } = await supabase.rpc('delete_chat_message', { p_member_id: memberId(), p_message_id: messageId })
  if (error || !data) return
  const body = bubble.querySelector<HTMLParagraphElement>('p')
  if (body) { body.hidden = false; body.textContent = 'Mensaje eliminado' }
  bubble.querySelector('.chat-attachment')?.remove()
  bubble.querySelector('.chat-reaction-row')?.remove()
  bubble.querySelector('.chat-tools')?.remove()
  if (message?.attachment_path) {
    const { error: cleanupError } = await supabase.storage.from('family-photos').remove([message.attachment_path])
    if (cleanupError) console.error('Deleted Chat attachment cleanup failed', cleanupError)
  }
}

async function enhanceBubble(bubble: HTMLElement) {
  if (bubble.dataset.chatEnhanced === '1') return
  bubble.dataset.chatEnhanced = '1'
  const messageId = bubble.dataset.messageId || ''
  if (!messageId) return

  const attachment = bubble.querySelector('.chat-attachment')
  const body = bubble.querySelector<HTMLParagraphElement>('p')
  const bodyText = body?.textContent?.trim() || ''
  if (attachment && body && (!bodyText || bodyText === '📷 Foto' || bodyText === 'Foto')) body.hidden = true
  bubble.querySelectorAll<HTMLElement>('.quoted[data-jump]').forEach(normalizeQuoted)
  if (bodyText === 'Mensaje eliminado') return

  const own = bubble.classList.contains('mine')
  const tools = document.createElement('div')
  tools.className = 'chat-tools'
  const reactions = ['❤️', '😂', '👍', '😮', '😢', '🙏']
  tools.innerHTML = `<button type="button" data-reply-action aria-label="Responder mensaje">↩ Responder</button><button type="button" data-reaction-toggle aria-expanded="false" aria-label="Mostrar reacciones">☺︎</button><span class="chat-reaction-picker">${reactions.map(r => `<button type="button" data-react="${r}" aria-label="Reaccionar ${r}">${r}</button>`).join('')}</span>`
  if (own && bodyText && !body?.hidden) tools.insertAdjacentHTML('beforeend', '<button type="button" data-edit>Editar</button>')
  if (own) tools.insertAdjacentHTML('beforeend', '<button type="button" class="danger" data-delete>Eliminar</button>')
  bubble.appendChild(tools)

  tools.addEventListener('click', async event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!target) return
    if (target.hasAttribute('data-reply-action')) { triggerReply(bubble); return }
    if (target.hasAttribute('data-reaction-toggle')) {
      const open = tools.classList.toggle('reactions-open')
      target.setAttribute('aria-expanded', String(open))
      return
    }
    const reaction = target.dataset.react
    if (reaction) {
      await toggleReaction(messageId, reaction)
      tools.classList.remove('reactions-open')
      tools.querySelector('[data-reaction-toggle]')?.setAttribute('aria-expanded', 'false')
      return
    }
    if (target.hasAttribute('data-edit')) {
      const text = body?.textContent || ''
      showDialog('Editar mensaje', text, async value => {
        const { data, error } = await supabase.rpc('edit_chat_message', { p_member_id: memberId(), p_message_id: messageId, p_body: value })
        if (!error && data && body) { body.textContent = value; setEditedState(bubble, true) }
      })
      return
    }
    if (target.hasAttribute('data-delete')) await deleteMessage(bubble, messageId)
  })

  await renderReactions(messageId)
}

function enhanceAll() {
  const list = chatList()
  if (!list) return
  list.querySelectorAll<HTMLElement>('.bubble[data-message-id]').forEach(bubble => void enhanceBubble(bubble))
  list.querySelectorAll<HTMLElement>('.quoted[data-jump]').forEach(normalizeQuoted)
}

function scrollChatToBottom() {
  const list = chatList()
  if (!list) return
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight })
}

function appendPendingPhoto(objectUrl: string) {
  const list = chatList()
  if (!list) return null
  list.querySelector('.empty')?.remove()
  const bubble = document.createElement('article')
  bubble.className = 'bubble mine chat-pending'
  bubble.innerHTML = `<div class="chat-pending-media"><img src="${esc(objectUrl)}" alt="Foto"></div><small><span class="chat-upload-spinner" aria-hidden="true"></span><span data-upload-state>Enviando…</span></small>`
  list.appendChild(bubble)
  scrollChatToBottom()
  return bubble
}

function setPendingState(bubble: HTMLElement, text: string, error = false) {
  const state = bubble.querySelector<HTMLElement>('[data-upload-state]')
  if (state) { state.textContent = text; state.classList.toggle('chat-upload-error', error) }
  if (error || text === 'Enviado') bubble.querySelector('.chat-upload-spinner')?.remove()
}

function reconcilePendingPhoto(messageId: string, tries = 0) {
  const pending = pendingPhotos.get(messageId)
  if (!pending) return
  const real = document.querySelector<HTMLElement>(`.bubble[data-message-id="${messageId}"]`)
  if (real) {
    pending.bubble.remove()
    URL.revokeObjectURL(pending.objectUrl)
    pendingPhotos.delete(messageId)
    scrollChatToBottom()
    return
  }
  if (tries < 40) window.setTimeout(() => reconcilePendingPhoto(messageId, tries + 1), 250)
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; dispose: () => void }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file)
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  await img.decode()
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, dispose: () => URL.revokeObjectURL(url) }
}

async function compressChatPhoto(file: File): Promise<{ blob: Blob; name: string; type: string }> {
  if (file.type === 'image/gif') return { blob: file, name: file.name, type: file.type || 'image/gif' }
  try {
    const decoded = await decodeImage(file)
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(decoded.source, 0, 0, width, height)
    decoded.dispose()
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image compression failed')), 'image/jpeg', 0.82))
    const base = file.name.replace(/\.[^.]+$/, '') || 'foto'
    return { blob, name: `${base}.jpg`, type: 'image/jpeg' }
  } catch {
    return { blob: file, name: file.name || 'foto.jpg', type: file.type || 'image/jpeg' }
  }
}

function sendTyping(typing: boolean) {
  if (!featureChannel) return
  void featureChannel.send({ type: 'broadcast', event: 'typing', payload: { memberId: memberId(), name: memberName(), typing } })
}

function installComposer() {
  const composer = document.querySelector<HTMLElement>('#composer')
  if (!composer || composer.dataset.chatRuntime === '1') return
  composer.dataset.chatRuntime = '1'
  const input = composer.querySelector<HTMLInputElement>('#message')
  if (!input) return

  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'image/*'
  file.hidden = true
  file.id = 'chatAttachmentInput'

  const attach = document.createElement('button')
  attach.type = 'button'
  attach.className = 'chat-attach-button'
  attach.textContent = '＋'
  attach.setAttribute('aria-label', 'Adjuntar foto')
  composer.insertBefore(attach, input)
  composer.appendChild(file)
  attach.addEventListener('click', () => file.click())

  file.addEventListener('change', async () => {
    const selected = file.files?.[0]
    file.value = ''
    if (!selected) return
    if (!selected.type.startsWith('image/')) { alert('Selecciona una imagen.'); return }
    if (selected.size > 15 * 1024 * 1024) { alert('La foto debe pesar menos de 15 MB.'); return }
    const id = memberId()
    if (!id) return

    const objectUrl = URL.createObjectURL(selected)
    const pendingBubble = appendPendingPhoto(objectUrl)
    if (!pendingBubble) { URL.revokeObjectURL(objectUrl); return }

    attach.disabled = true
    try {
      const optimized = await compressChatPhoto(selected)
      const ext = optimized.type === 'image/gif' ? 'gif' : 'jpg'
      const path = `chat/${id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('family-photos').upload(path, optimized.blob, { contentType: optimized.type, cacheControl: '31536000', upsert: false })
      if (uploadError) throw uploadError
      const { data: inserted, error: insertError } = await supabase.from('messages').insert({
        sender_id: id,
        body: '',
        attachment_path: path,
        attachment_type: optimized.type,
        attachment_name: optimized.name,
        attachment_size: optimized.blob.size
      }).select('id').single()
      if (insertError || !inserted?.id) {
        await supabase.storage.from('family-photos').remove([path])
        throw insertError || new Error('Message insert failed')
      }
      setPendingState(pendingBubble, 'Enviado')
      if (!chatOpen()) { pendingBubble.remove(); URL.revokeObjectURL(objectUrl); return }
      pendingPhotos.set(inserted.id, { bubble: pendingBubble, objectUrl })
      reconcilePendingPhoto(inserted.id)
    } catch (error) {
      console.error('Chat photo send failed', error)
      setPendingState(pendingBubble, 'No se pudo enviar', true)
      window.setTimeout(() => { pendingBubble.remove(); URL.revokeObjectURL(objectUrl) }, 2600)
    } finally {
      attach.disabled = false
    }
  })

  input.addEventListener('input', () => {
    sendTyping(true)
    if (typingStopTimer) window.clearTimeout(typingStopTimer)
    typingStopTimer = window.setTimeout(() => sendTyping(false), 900)
  })
  input.addEventListener('blur', () => sendTyping(false))
  composer.addEventListener('submit', () => sendTyping(false), { capture: true })
}

function clearTypingLater() {
  if (typingExpiryTimer) window.clearTimeout(typingExpiryTimer)
  typingExpiryTimer = window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>('#chatTyping')
    if (el) el.textContent = ''
  }, 1800)
}

function updatePresence() {
  const state = presenceChannel?.presenceState() as PresenceState | undefined
  const current = memberId()
  const unique = new Map<string, PresenceMeta>()
  Object.values(state || {}).flat().forEach(meta => {
    if (!meta.memberId || meta.memberId === current || unique.has(meta.memberId)) return
    unique.set(meta.memberId, meta)
  })
  const people = Array.from(unique.values())
  const el = document.querySelector<HTMLElement>('#chatPresence')
  if (!el) return
  el.textContent = people.length === 0 ? 'Solo tú' : people.length === 1 ? `${people[0]?.name || '1 familiar'} en línea` : `${people.length} familiares en línea`
}

function handleChatMessage(event: Event) {
  const detail = (event as CustomEvent<ChatEventDetail>).detail
  if (!detail || !chatOpen()) return
  if (detail.id) reconcilePendingPhoto(detail.id)
  const list = chatList()
  const indicator = document.querySelector<HTMLButtonElement>('.chat-new-indicator')
  if (detail.type === 'insert' && detail.sender_id !== memberId()) {
    if (list && isAtBottom(list)) scheduleMarkRead(40)
    else if (indicator) indicator.hidden = false
  }
  window.setTimeout(() => { enhanceAll(); void renderReadReceipts() }, 70)
}

function handleVisibility() {
  if (!chatStarted || document.visibilityState !== 'visible') return
  scheduleMarkRead(40)
  void renderReadReceipts()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') document.querySelector<HTMLButtonElement>('#cancelReply')?.click()
}

function startChat() {
  if (chatStarted || !chatOpen()) return
  const id = memberId()
  const list = chatList()
  if (!id || !list) return
  chatStarted = true
  activeList = list
  stopHomeUnreadRealtime()
  installStyle()

  const head = document.querySelector('.pagehead > div')
  if (head && !head.querySelector('.chat-presence')) head.insertAdjacentHTML('beforeend', '<div class="chat-presence" id="chatPresence">Conectando…</div>')
  if (!document.querySelector('#chatTyping')) {
    const typing = document.createElement('div')
    typing.className = 'chat-typing'
    typing.id = 'chatTyping'
    list.before(typing)
  }
  let indicator = document.querySelector<HTMLButtonElement>('.chat-new-indicator')
  if (!indicator) {
    indicator = document.createElement('button')
    indicator.type = 'button'
    indicator.className = 'chat-new-indicator'
    indicator.hidden = true
    indicator.textContent = 'Nuevos mensajes ↓'
    list.before(indicator)
  }

  installComposer()
  enhanceAll()
  window.setTimeout(enhanceAll, 120)
  window.setTimeout(enhanceAll, 400)

  const scrollHandler = () => {
    if (!activeList) return
    if (isAtBottom(activeList)) {
      indicator!.hidden = true
      scheduleMarkRead(100)
    }
  }
  list.addEventListener('scroll', scrollHandler, { passive: true })
  list.dataset.runtimeScrollBound = '1'
  ;(list as any).__chatRuntimeScrollHandler = scrollHandler

  indicator.addEventListener('click', () => {
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
    indicator!.hidden = true
    scheduleMarkRead(80)
  })

  list.addEventListener('click', event => {
    const quoted = (event.target as HTMLElement).closest<HTMLElement>('.quoted[data-jump]')
    if (!quoted) return
    const id = quoted.dataset.jump || ''
    window.setTimeout(() => {
      const target = id ? document.querySelector<HTMLElement>(`.bubble[data-message-id="${id}"]`) : null
      if (!target) return
      target.classList.remove('chat-reply-flash')
      void target.offsetWidth
      target.classList.add('chat-reply-flash')
      window.setTimeout(() => target.classList.remove('chat-reply-flash'), 1200)
    }, 80)
  })

  listObserver = new MutationObserver(() => enhanceAll())
  listObserver.observe(list, { childList: true, subtree: true })

  featureChannel = supabase.channel(`familia-noa-chat-features-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, payload => {
      const messageId = (payload.new as any)?.message_id || (payload.old as any)?.message_id
      if (messageId) void renderReactions(messageId)
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_read_receipts' }, () => void renderReadReceipts())
    .on('broadcast', { event: 'typing' }, payload => {
      const data = payload.payload as any
      if (!data || data.memberId === memberId()) return
      const el = document.querySelector<HTMLElement>('#chatTyping')
      if (!el) return
      el.textContent = data.typing ? `${data.name || 'Alguien'} está escribiendo…` : ''
      if (data.typing) clearTypingLater()
      else if (typingExpiryTimer) window.clearTimeout(typingExpiryTimer)
    })
    .subscribe()

  presenceChannel = supabase.channel('familia-noa-chat-presence', { config: { presence: { key: id } } })
    .on('presence', { event: 'sync' }, updatePresence)
    .on('presence', { event: 'join' }, updatePresence)
    .on('presence', { event: 'leave' }, updatePresence)
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel?.track({ memberId: id, name: memberName(), onlineAt: new Date().toISOString() })
        updatePresence()
      }
    })

  chatMessageHandler = handleChatMessage
  window.addEventListener('familia-noa:chat-message', chatMessageHandler)
  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('focus', handleVisibility)
  document.addEventListener('keydown', handleKeydown)

  scheduleMarkRead(180)
  void renderReadReceipts()
}

function stopChat() {
  if (!chatStarted) return
  chatStarted = false
  if (activeList) {
    const handler = (activeList as any).__chatRuntimeScrollHandler as (() => void) | undefined
    if (handler) activeList.removeEventListener('scroll', handler)
    delete (activeList as any).__chatRuntimeScrollHandler
  }
  activeList = null
  listObserver?.disconnect()
  listObserver = null
  if (typingStopTimer) window.clearTimeout(typingStopTimer)
  if (typingExpiryTimer) window.clearTimeout(typingExpiryTimer)
  if (readTimer) window.clearTimeout(readTimer)
  typingStopTimer = null
  typingExpiryTimer = null
  readTimer = null
  sendTyping(false)
  if (chatMessageHandler) window.removeEventListener('familia-noa:chat-message', chatMessageHandler)
  chatMessageHandler = null
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('focus', handleVisibility)
  document.removeEventListener('keydown', handleKeydown)
  void featureChannel?.unsubscribe()
  featureChannel = null
  void presenceChannel?.untrack()
  void presenceChannel?.unsubscribe()
  presenceChannel = null
  pendingPhotos.forEach(item => URL.revokeObjectURL(item.objectUrl))
  pendingPhotos.clear()
}

function scan() {
  installStyle()
  if (chatOpen()) {
    stopHomeUnreadRealtime()
    startChat()
  } else {
    stopChat()
    if (document.querySelector('.shell')) {
      startHomeUnreadRealtime()
      scheduleUnreadRefresh()
    } else {
      stopHomeUnreadRealtime()
    }
  }
}

const pageObserver = new MutationObserver(scan)
pageObserver.observe(document.body, { childList: true, subtree: true })
scan()

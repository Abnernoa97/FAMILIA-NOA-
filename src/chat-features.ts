import { supabase } from './supabase'

type FeatureMessage = {
  id: string
  sender_id: string
  body: string
  deleted_at: string | null
  attachment_path: string | null
  attachment_type: string | null
  attachment_name: string | null
}

type ChatFeaturesOptions = {
  list: HTMLElement
  composer: HTMLFormElement
  input: HTMLInputElement
  preview: HTMLElement
  memberId: string
  getMessage: (id: string) => FeatureMessage | undefined
  getMessages: () => FeatureMessage[]
  imageUrl: (path: string) => string
  isAtBottom: () => boolean
  scrollLatest: () => void
  applyLocalUpdate: (id: string, patch: Partial<FeatureMessage>) => void
  removeMedia?: (path: string) => Promise<void>
}

type ReactionRow = { message_id: string; member_id: string; reaction: string }

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))

let homeUnreadChannel: ReturnType<typeof supabase.channel> | null = null
let homeUnreadMemberId = ''

function unreadBadge(count: number) {
  document.querySelectorAll('.chat-unread-badge').forEach(el => el.remove())
  if (count <= 0) return
  const text = count > 99 ? '99+' : String(count)
  document.querySelector('#chat b')?.insertAdjacentHTML('beforeend', `<span class="chat-unread-badge">${text}</span>`)
  document.querySelector('#navchat')?.insertAdjacentHTML('beforeend', `<span class="chat-unread-badge">${text}</span>`)
}

async function refreshHomeUnread(memberId: string) {
  if (!memberId || !document.querySelector('.shell')) return
  const { data, error } = await supabase.rpc('get_chat_unread_count', { p_member_id: memberId })
  if (!error) unreadBadge(Number(data || 0))
}

export function stopHomeChatUnread() {
  void homeUnreadChannel?.unsubscribe()
  homeUnreadChannel = null
  homeUnreadMemberId = ''
}

export function startHomeChatUnread(memberId: string) {
  stopHomeChatUnread()
  if (!memberId) return
  homeUnreadMemberId = memberId
  void refreshHomeUnread(memberId)
  homeUnreadChannel = supabase.channel(`familia-noa-chat-unread-${memberId}`)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, () => {
      window.setTimeout(() => {
        if (homeUnreadMemberId === memberId) void refreshHomeUnread(memberId)
      }, 80)
    })
    .subscribe()
}

function showEditDialog(initial: string, onSave: (value: string) => Promise<void>) {
  const overlay = document.createElement('div')
  overlay.className = 'chat-dialog'
  overlay.innerHTML = `<div class="chat-dialog-card"><h3>Editar mensaje</h3><textarea id="chatEditInput">${esc(initial)}</textarea><div class="chat-dialog-actions"><button type="button" data-cancel>Cancelar</button><button type="button" class="confirm" data-save>Guardar</button></div></div>`
  document.body.appendChild(overlay)
  const editInput = overlay.querySelector<HTMLTextAreaElement>('#chatEditInput')!
  editInput.focus()
  editInput.setSelectionRange(editInput.value.length, editInput.value.length)
  const close = () => overlay.remove()
  overlay.querySelector('[data-cancel]')!.addEventListener('click', close)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  overlay.querySelector<HTMLButtonElement>('[data-save]')!.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement
    const value = editInput.value.trim()
    if (!value) return
    button.disabled = true
    try { await onSave(value); close() } finally { button.disabled = false }
  })
}

export function startChatFeatures(options: ChatFeaturesOptions) {
  const { list, composer, input, preview, memberId } = options
  let replyToId = ''
  let readTimer: number | null = null
  let receiptTimer: number | null = null
  let reactionTimer: number | null = null
  let featureChannel: ReturnType<typeof supabase.channel> | null = null
  let lastReadTail = ''
  const pendingReactionIds = new Set<string>()
  const mediaCleanup = new Set<string>()

  const messageElement = (id:string) => list.querySelector<HTMLElement>(`.chat-bubble[data-message-id="${CSS.escape(id)}"]`)

  const cleanupDeletedMedia = (message:FeatureMessage) => {
    const path = message.attachment_path
    if (!path || !message.deleted_at || message.sender_id !== memberId || !options.removeMedia || mediaCleanup.has(path)) return
    mediaCleanup.add(path)
    void options.removeMedia(path)
      .catch(error => console.error('Deleted Chat media cleanup failed', error))
      .finally(() => mediaCleanup.delete(path))
  }

  const renderReplyPreview = () => {
    if (!replyToId) {
      preview.innerHTML = ''
      delete composer.dataset.replyToId
      return
    }
    const message = options.getMessage(replyToId)
    if (!message || message.deleted_at) {
      replyToId = ''
      preview.innerHTML = ''
      delete composer.dataset.replyToId
      return
    }
    composer.dataset.replyToId = replyToId
    const isImage = !!message.attachment_path && (message.attachment_type || '').startsWith('image/')
    if (isImage) {
      const src = options.imageUrl(message.attachment_path!)
      preview.innerHTML = `<div class="chat-reply-preview image-only"><img src="${esc(src)}" alt="Foto respondida" decoding="async"><button type="button" data-cancel-reply aria-label="Cancelar respuesta">×</button></div>`
    } else {
      const label = message.body || (message.attachment_type?.startsWith('video/') ? 'Video' : message.attachment_type?.startsWith('audio/') ? 'Audio' : 'Mensaje')
      preview.innerHTML = `<div class="chat-reply-preview"><div><b>Respondiendo</b><span>${esc(label)}</span></div><button type="button" data-cancel-reply aria-label="Cancelar respuesta">×</button></div>`
    }
  }

  const setReply = (id:string) => {
    const message = options.getMessage(id)
    if (!message || message.deleted_at) return
    replyToId = id
    renderReplyPreview()
    input.focus()
    options.scrollLatest()
  }

  const clearReply = () => {
    replyToId = ''
    renderReplyPreview()
  }

  const reactionMarkup = (rows:ReactionRow[]) => {
    const counts = new Map<string,number>()
    const mine = new Set<string>()
    rows.forEach(row => {
      counts.set(row.reaction, (counts.get(row.reaction) || 0) + 1)
      if (row.member_id === memberId) mine.add(row.reaction)
    })
    return [...counts.entries()].map(([reaction,count]) => `<button type="button" class="chat-reaction${mine.has(reaction) ? ' is-mine' : ''}" data-react="${esc(reaction)}">${reaction} ${count}</button>`).join('')
  }

  const renderReactions = (rows:ReactionRow[], ids:string[]) => {
    const grouped = new Map<string,ReactionRow[]>()
    rows.forEach(row => grouped.set(row.message_id, [...(grouped.get(row.message_id) || []), row]))
    ids.forEach(id => {
      const bubble = messageElement(id)
      if (!bubble) return
      let row = bubble.querySelector<HTMLElement>('.chat-reaction-row')
      const html = reactionMarkup(grouped.get(id) || [])
      if (!html) { row?.remove(); return }
      if (!row) {
        row = document.createElement('div')
        row.className = 'chat-reaction-row'
        bubble.appendChild(row)
      }
      row.innerHTML = html
    })
  }

  const refreshReactions = async (ids:string[]) => {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return
    const { data, error } = await supabase.from('chat_reactions').select('message_id,member_id,reaction').in('message_id', unique)
    if (!error) renderReactions((data || []) as ReactionRow[], unique)
  }

  const scheduleReactionRefresh = (id:string) => {
    if (id) pendingReactionIds.add(id)
    if (reactionTimer) window.clearTimeout(reactionTimer)
    reactionTimer = window.setTimeout(() => {
      const ids = [...pendingReactionIds]
      pendingReactionIds.clear()
      void refreshReactions(ids)
    }, 80)
  }

  const refreshReadReceipts = async () => {
    const ownIds = options.getMessages().filter(message => message.sender_id === memberId).map(message => message.id)
    if (!ownIds.length) return
    const { data, error } = await supabase.rpc('get_chat_read_receipts', { p_message_ids:ownIds })
    if (error) return
    const read = new Set((data || []).filter((row:any) => row.member_id !== memberId).map((row:any) => row.message_id))
    ownIds.forEach(id => {
      const meta = messageElement(id)?.querySelector<HTMLElement>('.chat-meta')
      if (!meta) return
      let state = meta.querySelector<HTMLElement>('.chat-read-state')
      if (read.has(id)) {
        if (!state) {
          state = document.createElement('span')
          state.className = 'chat-read-state'
          meta.appendChild(state)
        }
        state.textContent = ' ✓✓'
      } else state?.remove()
    })
  }

  const scheduleReceiptRefresh = () => {
    if (receiptTimer) window.clearTimeout(receiptTimer)
    receiptTimer = window.setTimeout(() => void refreshReadReceipts(), 120)
  }

  const markRead = async (force=false) => {
    if (document.visibilityState !== 'visible' || !options.isAtBottom()) return
    const incoming = options.getMessages().filter(message => message.sender_id !== memberId && !message.deleted_at).slice(-80)
    const tail = incoming.at(-1)?.id || ''
    if (!force && tail && tail === lastReadTail) return
    lastReadTail = tail
    const { error } = await supabase.rpc('mark_chat_messages_read', { p_member_id:memberId, p_message_ids:incoming.map(message => message.id) })
    if (!error) {
      unreadBadge(0)
      scheduleReceiptRefresh()
    }
  }

  const scheduleMarkRead = (delay=100, force=false) => {
    if (readTimer) window.clearTimeout(readTimer)
    readTimer = window.setTimeout(() => void markRead(force), delay)
  }

  const decorateMessage = (bubble:HTMLElement, message:FeatureMessage) => {
    if (bubble.dataset.featuresReady === '1') return
    bubble.dataset.featuresReady = '1'
    if (message.deleted_at) return
    const own = message.sender_id === memberId
    const canEdit = own && !!message.body.trim() && !message.attachment_path
    const tools = document.createElement('div')
    tools.className = 'chat-tools'
    tools.innerHTML = `<button type="button" data-reply>↩ Responder</button><button type="button" data-reaction-toggle aria-label="Reaccionar">☺︎</button><span class="chat-reaction-picker">${['❤️','😂','👍','😮','😢','🙏'].map(reaction => `<button type="button" data-react="${reaction}">${reaction}</button>`).join('')}</span>${canEdit ? '<button type="button" data-edit>Editar</button>' : ''}${own ? '<button type="button" data-delete>Eliminar</button>' : ''}`
    bubble.appendChild(tools)
  }

  const decorateAll = () => options.getMessages().forEach(message => {
    const bubble = messageElement(message.id)
    if (bubble) decorateMessage(bubble, message)
  })

  const onListClick = async (event:Event) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-cancel-reply]')) { clearReply(); return }
    const bubble = target.closest<HTMLElement>('.chat-bubble[data-message-id]')
    const messageId = bubble?.dataset.messageId || ''
    if (!bubble || !messageId) return

    if (target.closest('[data-reply]')) { setReply(messageId); return }
    if (target.closest('[data-reaction-toggle]')) { bubble.classList.toggle('reactions-open'); return }

    const reactionButton = target.closest<HTMLButtonElement>('[data-react]')
    if (reactionButton) {
      bubble.classList.remove('reactions-open')
      const reaction = reactionButton.dataset.react || ''
      if (!reaction) return
      const { error } = await supabase.rpc('toggle_chat_reaction', { p_member_id:memberId, p_message_id:messageId, p_reaction:reaction })
      if (!error) await refreshReactions([messageId])
      return
    }

    if (target.closest('[data-edit]')) {
      const message = options.getMessage(messageId)
      if (!message || message.sender_id !== memberId || message.deleted_at) return
      showEditDialog(message.body, async value => {
        const { data, error } = await supabase.rpc('edit_chat_message', { p_member_id:memberId, p_message_id:messageId, p_body:value })
        if (!error && data) options.applyLocalUpdate(messageId, { body:value })
      })
      return
    }

    if (target.closest('[data-delete]')) {
      const message = options.getMessage(messageId)
      if (!message || message.sender_id !== memberId || message.deleted_at) return
      if (!confirm('¿Eliminar este mensaje?')) return
      const mediaPath = message.attachment_path
      const { data, error } = await supabase.rpc('delete_chat_message', { p_member_id:memberId, p_message_id:messageId })
      if (!error && data) {
        if (replyToId === messageId) clearReply()
        options.applyLocalUpdate(messageId, {
          deleted_at:new Date().toISOString(),
          body:'',
          attachment_path:null,
          attachment_type:null,
          attachment_name:null
        })
        if (mediaPath && options.removeMedia) {
          mediaCleanup.add(mediaPath)
          void options.removeMedia(mediaPath)
            .catch(cleanupError => console.error('Deleted Chat media cleanup failed', cleanupError))
            .finally(() => mediaCleanup.delete(mediaPath))
        }
      }
      return
    }

    const quoted = target.closest<HTMLElement>('[data-jump]')
    if (quoted) {
      const source = messageElement(quoted.dataset.jump || '')
      if (!source) return
      source.scrollIntoView({ behavior:'smooth', block:'center' })
      source.classList.remove('chat-reply-flash')
      void source.offsetWidth
      source.classList.add('chat-reply-flash')
      window.setTimeout(() => source.classList.remove('chat-reply-flash'), 900)
    }
  }

  const onDoubleClick = (event:MouseEvent) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('.chat-bubble[data-message-id]')?.dataset.messageId
    if (id) setReply(id)
  }

  let touchId = ''
  let touchX = 0
  let touchY = 0
  const onTouchStart = (event:TouchEvent) => {
    const bubble = (event.target as HTMLElement).closest<HTMLElement>('.chat-bubble[data-message-id]')
    if (!bubble) return
    const touch = event.touches[0]
    touchId = bubble.dataset.messageId || ''
    touchX = touch.clientX
    touchY = touch.clientY
  }
  const onTouchEnd = (event:TouchEvent) => {
    if (!touchId) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - touchX
    const dy = Math.abs(touch.clientY - touchY)
    const id = touchId
    touchId = ''
    if (dx > 58 && dx > dy * 1.2) setReply(id)
  }

  const onScroll = () => { if (options.isAtBottom()) scheduleMarkRead(100) }
  const onVisibility = () => { if (document.visibilityState === 'visible') scheduleMarkRead(80, true) }

  list.addEventListener('click', onListClick)
  list.addEventListener('dblclick', onDoubleClick)
  list.addEventListener('touchstart', onTouchStart, { passive:true })
  list.addEventListener('touchend', onTouchEnd, { passive:true })
  list.addEventListener('scroll', onScroll, { passive:true })
  preview.addEventListener('click', onListClick)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onVisibility)

  featureChannel = supabase.channel(`familia-noa-chat-features-${memberId}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'chat_reactions' }, payload => {
      scheduleReactionRefresh((payload.new as any)?.message_id || (payload.old as any)?.message_id || '')
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'chat_read_receipts' }, scheduleReceiptRefresh)
    .subscribe()

  decorateAll()
  options.getMessages().forEach(cleanupDeletedMedia)
  void refreshReactions(options.getMessages().map(message => message.id))
  scheduleMarkRead(160, true)
  scheduleReceiptRefresh()

  return {
    getReplyToId: () => replyToId || null,
    clearReply,
    decorateMessage,
    decorateAll,
    refreshReactions,
    onMessageInserted(message:FeatureMessage) {
      const bubble = messageElement(message.id)
      if (bubble) decorateMessage(bubble, message)
      cleanupDeletedMedia(message)
      if (options.isAtBottom()) scheduleMarkRead(80)
    },
    onMessagesPrepended(ids:string[]) {
      decorateAll()
      ids.forEach(id => {
        const message = options.getMessage(id)
        if (message) cleanupDeletedMedia(message)
      })
      void refreshReactions(ids)
    },
    onMessageUpdated(message:FeatureMessage) {
      const bubble = messageElement(message.id)
      if (bubble) decorateMessage(bubble, message)
      cleanupDeletedMedia(message)
      scheduleReactionRefresh(message.id)
      scheduleReceiptRefresh()
    },
    cleanup() {
      if (readTimer) window.clearTimeout(readTimer)
      if (receiptTimer) window.clearTimeout(receiptTimer)
      if (reactionTimer) window.clearTimeout(reactionTimer)
      list.removeEventListener('click', onListClick)
      list.removeEventListener('dblclick', onDoubleClick)
      list.removeEventListener('touchstart', onTouchStart)
      list.removeEventListener('touchend', onTouchEnd)
      list.removeEventListener('scroll', onScroll)
      preview.removeEventListener('click', onListClick)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      void featureChannel?.unsubscribe()
      featureChannel = null
      mediaCleanup.clear()
    }
  }
}

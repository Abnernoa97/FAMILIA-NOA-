import { supabase } from './supabase'
import { getIdentity } from './core/identity'

type PresenceState = Record<string, Array<{ memberId?: string; name?: string; onlineAt?: string }>>

let homeObserver: MutationObserver | null = null
let chatInitialized = false
let chatChannel: ReturnType<typeof supabase.channel> | null = null
let presenceChannel: ReturnType<typeof supabase.channel> | null = null
let chatListObserver: MutationObserver | null = null
let typingStopTimer: number | null = null
let unreadRefreshTimer: number | null = null

const identity = () => getIdentity()
const esc = (v: string) => v.replace(/[&<>\\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\\"':'&quot;', "'":'&#039;' }[c]!))
const currentMemberId = () => identity()?.memberId || ''

function badgeStyle() {
  if (document.getElementById('chat-feature-style')) return
  const s = document.createElement('style')
  s.id = 'chat-feature-style'
  s.textContent = `
    .chat-unread-badge{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#171716;color:#fff;font-size:10px;font-weight:700;margin-left:6px;vertical-align:middle}
    .chat-new-indicator{position:sticky;top:6px;z-index:12;align-self:center;background:#171716;color:#fff;border-radius:999px;padding:8px 14px;font-size:12px;font-weight:700;box-shadow:0 8px 24px #0003;cursor:pointer}
    .chat-presence{font-size:11px;color:#77736b;margin-top:3px;min-height:15px}
    .chat-typing{font-size:11px;color:#77736b;text-align:center;min-height:16px;padding:0 14px}
    .chat-tools{display:flex;gap:4px;align-items:center;margin-top:5px;opacity:.82;flex-wrap:wrap}
    .chat-tools button{background:#eeeae2;border-radius:999px;min-width:28px;height:26px;padding:0 7px;font-size:12px}
    .chat-tools .danger{color:#9a3f32}
    .chat-reaction-picker{display:none;gap:4px;flex-wrap:wrap}
    .chat-tools.reactions-open .chat-reaction-picker{display:flex}
    .chat-reaction-row{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    .chat-reaction{background:#f0ece4;border-radius:999px;padding:3px 7px;font-size:11px}
    .chat-attachment{display:block;margin-top:8px;border-radius:12px;overflow:hidden;background:#e8e3da;text-decoration:none;color:#171716}
    .chat-attachment img{display:block;width:100%;max-height:260px;object-fit:cover}
    .chat-attachment span{display:block;padding:8px 10px;font-size:12px}
    .chat-read-state{font-size:10px;color:#8a867e;margin-left:4px}
    .chat-edited-state{font-size:10px;color:#8a867e;margin-left:4px}
    .chat-attach-button{width:42px;height:42px;border-radius:50%;background:#fff;border:1px solid #d9d4ca;font-size:19px}
    .chat-dialog{position:fixed;inset:0;background:#17171655;backdrop-filter:blur(5px);display:flex;align-items:flex-end;z-index:100}
    .chat-dialog-card{background:#f8f5ee;width:100%;max-width:760px;margin:auto;padding:24px;border-radius:28px 28px 0 0}
    .chat-dialog-card h3{font:500 28px 'Playfair Display',serif;margin:0 0 8px}
    .chat-dialog-card textarea{width:100%;min-height:110px;border:1px solid #d9d4ca;border-radius:16px;padding:14px;resize:vertical;background:#fff}
    .chat-dialog-actions{display:flex;gap:8px;margin-top:12px}.chat-dialog-actions button{flex:1;padding:13px;border-radius:14px}.chat-dialog-actions .confirm{background:#171716;color:#fff}
  `
  document.head.appendChild(s)
}

async function refreshUnread() {
  const id = currentMemberId()
  const card = document.querySelector<HTMLElement>('#chat')
  const nav = document.querySelector<HTMLElement>('#navchat')
  if (!id || (!card && !nav)) return
  const { data } = await supabase.rpc('get_chat_unread_count', { p_member_id: id })
  const count = Number(data || 0)
  document.querySelectorAll('.chat-unread-badge').forEach(el => el.remove())
  if (count <= 0) return
  if (card) {
    const label = card.querySelector('b')
    if (label) label.insertAdjacentHTML('beforeend', `<span class="chat-unread-badge">${count > 99 ? '99+' : count}</span>`)
  }
  if (nav) nav.insertAdjacentHTML('beforeend', `<span class="chat-unread-badge">${count > 99 ? '99+' : count}</span>`)
}

function scheduleUnreadRefresh() {
  if (unreadRefreshTimer) window.clearTimeout(unreadRefreshTimer)
  unreadRefreshTimer = window.setTimeout(() => void refreshUnread(), 150)
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
  overlay.querySelector('#chatDialogConfirm')!.addEventListener('click', async () => {
    const value = input.value.trim()
    if (!value) return
    const button = overlay.querySelector<HTMLButtonElement>('#chatDialogConfirm')!
    button.disabled = true
    await onConfirm(value)
    overlay.remove()
  })
}

async function markRead() {
  const id = currentMemberId()
  const list = document.querySelector<HTMLElement>('#messages')
  if (!id || !list) return
  const { data } = await supabase.from('messages').select('id').neq('sender_id', id).order('created_at', { ascending: false }).limit(100)
  const ids = (data || []).map((x: any) => x.id).filter(Boolean)
  await supabase.rpc('mark_chat_read', { p_member_id: id, p_read_at: new Date().toISOString() })
  for (const messageId of ids.slice(0, 25)) void supabase.rpc('mark_chat_message_read', { p_member_id: id, p_message_id: messageId })
  scheduleUnreadRefresh()
}

async function renderReadReceipts() {
  const list = document.querySelector<HTMLElement>('#messages')
  const id = currentMemberId()
  if (!list || !id) return
  const own = Array.from(list.querySelectorAll<HTMLElement>('.bubble.mine[data-message-id]')).map(x => x.dataset.messageId).filter(Boolean) as string[]
  if (!own.length) return
  const { data } = await supabase.rpc('get_chat_read_receipts', { p_message_ids: own })
  const readIds = new Set((data || []).filter((x: any) => x.member_id !== id).map((x: any) => x.message_id))
  for (const bubble of list.querySelectorAll<HTMLElement>('.bubble.mine[data-message-id]')) {
    const small = bubble.querySelector('small')
    if (!small) continue
    small.querySelector('.chat-read-state')?.remove()
    if (readIds.has(bubble.dataset.messageId || '')) small.insertAdjacentHTML('beforeend', '<span class="chat-read-state">✓✓</span>')
  }
}

async function toggleReaction(messageId: string, reaction: string) {
  const id = currentMemberId()
  if (!id) return
  await supabase.rpc('toggle_chat_reaction', { p_member_id: id, p_message_id: messageId, p_reaction: reaction })
  await renderReactions(messageId)
}

async function renderReactions(messageId: string) {
  const bubble = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
  if (!bubble) return
  const { data } = await supabase.from('chat_reactions').select('member_id,reaction').eq('message_id', messageId)
  const rows = data || []
  const existing = bubble.querySelector<HTMLElement>('.chat-reaction-row')
  if (!rows.length) {
    existing?.remove()
    return
  }
  const row = existing || document.createElement('div')
  row.className = 'chat-reaction-row'
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.reaction, (counts.get(r.reaction) || 0) + 1)
  row.innerHTML = Array.from(counts.entries()).map(([r, n]) => `<button type="button" class="chat-reaction" data-react="${esc(r)}" aria-label="Quitar o cambiar reacción ${esc(r)}">${r} ${n}</button>`).join('')
  if (!existing) bubble.appendChild(row)
}

async function enhanceBubble(bubble: HTMLElement) {
  if (bubble.dataset.chatEnhanced === '1') return
  bubble.dataset.chatEnhanced = '1'
  const id = bubble.dataset.messageId || ''
  if (!id) return
  const own = bubble.classList.contains('mine')
  const tools = document.createElement('div')
  tools.className = 'chat-tools'
  const reactions = ['❤️', '😂', '👍', '😮', '😢', '🙏']
  tools.innerHTML = `<button type="button" data-reaction-toggle aria-expanded="false" aria-label="Mostrar reacciones">☺︎</button><span class="chat-reaction-picker">${reactions.map(r => `<button type="button" data-react="${r}" aria-label="Reaccionar ${r}">${r}</button>`).join('')}</span>`
  if (own) tools.insertAdjacentHTML('beforeend', '<button type="button" data-edit>Editar</button><button type="button" class="danger" data-delete>Eliminar</button>')
  bubble.appendChild(tools)
  tools.addEventListener('click', async e => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!target) return
    if (target.hasAttribute('data-reaction-toggle')) {
      const open = tools.classList.toggle('reactions-open')
      target.setAttribute('aria-expanded', String(open))
      return
    }
    const reaction = target.dataset.react
    if (reaction) {
      await toggleReaction(id, reaction)
      tools.classList.remove('reactions-open')
      tools.querySelector('[data-reaction-toggle]')?.setAttribute('aria-expanded', 'false')
      return
    }
    if (target.hasAttribute('data-edit')) {
      const body = bubble.querySelector('p')?.textContent || ''
      showDialog('Editar mensaje', body, async value => {
        const { data, error } = await supabase.rpc('edit_chat_message', { p_member_id: currentMemberId(), p_message_id: id, p_body: value })
        if (!error && data) {
          const p = bubble.querySelector('p')
          if (p) p.textContent = value
          setEditedState(bubble, true)
        }
      })
    }
    if (target.hasAttribute('data-delete')) {
      if (!confirm('¿Eliminar este mensaje?')) return
      const { data, error } = await supabase.rpc('delete_chat_message', { p_member_id: currentMemberId(), p_message_id: id })
      if (!error && data) {
        const p = bubble.querySelector('p')
        if (p) p.textContent = 'Mensaje eliminado'
        bubble.querySelector('.chat-attachment')?.remove()
        bubble.querySelector('.chat-reaction-row')?.remove()
        tools.remove()
      }
    }
  })
  await renderReactions(id)
}

function installComposer() {
  const composer = document.querySelector<HTMLElement>('#composer')
  if (!composer || composer.dataset.chatFeatures === '1') return
  composer.dataset.chatFeatures = '1'
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
    if (!selected) return
    if (selected.size > 10 * 1024 * 1024) {
      alert('La foto debe pesar menos de 10 MB.')
      file.value = ''
      return
    }
    const id = currentMemberId()
    if (!id) return
    attach.disabled = true
    const ext = (selected.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `chat/${id}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('family-photos').upload(path, selected, { contentType: selected.type || 'image/jpeg', cacheControl: '3600', upsert: false })
    if (uploadError) {
      alert('No se pudo subir la foto.')
      attach.disabled = false
      file.value = ''
      return
    }
    const { error: insertError } = await supabase.from('messages').insert({ sender_id: id, body: '📷 Foto', attachment_path: path, attachment_type: selected.type || 'image/jpeg', attachment_name: selected.name, attachment_size: selected.size })
    if (insertError) {
      await supabase.storage.from('family-photos').remove([path])
      alert('No se pudo enviar la foto.')
    }
    attach.disabled = false
    file.value = ''
  })
  input.addEventListener('input', () => {
    if (!chatChannel) return
    void chatChannel.send({ type: 'broadcast', event: 'typing', payload: { memberId: currentMemberId(), name: identity()?.name || 'Familia', typing: true } })
    if (typingStopTimer) window.clearTimeout(typingStopTimer)
    typingStopTimer = window.setTimeout(() => {
      if (chatChannel) void chatChannel.send({ type: 'broadcast', event: 'typing', payload: { memberId: currentMemberId(), name: identity()?.name || 'Familia', typing: false } })
    }, 900)
  })
}

function updatePresence() {
  const state = presenceChannel?.presenceState() as PresenceState
  const people = Object.values(state || {}).flat().filter(x => x.memberId !== currentMemberId())
  const el = document.querySelector<HTMLElement>('#chatPresence')
  if (!el) return
  el.textContent = people.length === 0
    ? 'Solo tú'
    : people.length === 1
      ? `${people[0]?.name || '1 persona'} en línea`
      : `${people.length} familiares en línea`
}

function initChat() {
  if (chatInitialized || !document.querySelector('.chat-page')) return
  chatInitialized = true
  badgeStyle()
  const list = document.querySelector<HTMLElement>('#messages')
  if (!list) {
    chatInitialized = false
    return
  }

  const head = document.querySelector('.pagehead > div')
  if (head && !head.querySelector('.chat-presence')) head.insertAdjacentHTML('beforeend', '<div class="chat-presence" id="chatPresence">Conectando…</div>')

  const typing = document.createElement('div')
  typing.className = 'chat-typing'
  typing.id = 'chatTyping'
  list.before(typing)

  const indicator = document.createElement('button')
  indicator.type = 'button'
  indicator.className = 'chat-new-indicator'
  indicator.hidden = true
  indicator.textContent = 'Nuevos mensajes ↓'
  list.before(indicator)

  installComposer()
  const enhanceAll = () => list.querySelectorAll<HTMLElement>('.bubble').forEach(b => void enhanceBubble(b))
  enhanceAll()
    void markRead()
  void renderReadReceipts()

  let lastAtBottom = true
  const chatMessageHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail as { type?: string; id?: string; sender_id?: string } | undefined
    if (!detail) return
    if (detail.type === 'insert' && detail.sender_id !== currentMemberId() && !lastAtBottom) {
      indicator.hidden = false
      indicator.textContent = 'Nuevos mensajes ↓'
    }
    scheduleUnreadRefresh()
    void renderReadReceipts()
  }
  window.addEventListener('familia-noa:chat-message', chatMessageHandler)
  list.addEventListener('scroll', () => {
    lastAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 100
    if (lastAtBottom) {
      indicator.hidden = true
      void markRead()
    }
  }, { passive: true })

  indicator.addEventListener('click', () => {
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
    indicator.hidden = true
    void markRead()
  })

  chatChannel = supabase.channel('familia-noa-chat-features')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions' }, payload => {
      const id = (payload.new as any)?.message_id || (payload.old as any)?.message_id
      if (id) void renderReactions(id)
    })
    .on('broadcast', { event: 'typing' }, payload => {
      const p = payload.payload as any
      if (!p || p.memberId === currentMemberId()) return
      const el = document.querySelector<HTMLElement>('#chatTyping')
      if (!el) return
      el.textContent = p.typing ? `${p.name || 'Alguien'} está escribiendo…` : ''
    })
    .subscribe()

  presenceChannel = supabase.channel('familia-noa-chat-presence', { config: { presence: { key: currentMemberId() } } })
    .on('presence', { event: 'sync' }, updatePresence)
    .on('presence', { event: 'join' }, updatePresence)
    .on('presence', { event: 'leave' }, updatePresence)
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel?.track({ memberId: currentMemberId(), name: identity()?.name || 'Familia', onlineAt: new Date().toISOString() })
        updatePresence()
      }
    })

  chatListObserver = new MutationObserver(() => enhanceAll())
  chatListObserver.observe(list, { childList: true, subtree: true })
}

function teardownChat() {
  chatInitialized = false
  chatListObserver?.disconnect()
  chatListObserver = null
  if (typingStopTimer) window.clearTimeout(typingStopTimer)
  typingStopTimer = null
  void chatChannel?.send({ type: 'broadcast', event: 'typing', payload: { memberId: currentMemberId(), name: identity()?.name || 'Familia', typing: false } })
  void chatChannel?.unsubscribe()
  chatChannel = null
  void presenceChannel?.untrack()
  void presenceChannel?.unsubscribe()
  presenceChannel = null
}

function scan() {
  badgeStyle()
  if (document.querySelector('.chat-page')) initChat()
  else teardownChat()
  if (document.querySelector('.shell')) scheduleUnreadRefresh()
}

homeObserver = new MutationObserver(scan)
homeObserver.observe(document.body, { childList: true, subtree: true })
scan()

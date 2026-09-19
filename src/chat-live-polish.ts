import { supabase } from './supabase'
import { getIdentity } from './core/identity'

type PresenceMeta = { memberId?: string; name?: string; onlineAt?: string }
type PresenceState = Record<string, PresenceMeta[]>

let started = false
let receiptChannel: ReturnType<typeof supabase.channel> | null = null
let presenceChannel: ReturnType<typeof supabase.channel> | null = null
let listObserver: MutationObserver | null = null
let presenceObserver: MutationObserver | null = null
let typingObserver: MutationObserver | null = null
let typingExpiryTimer: number | null = null
let reactionRefreshTimer: number | null = null
let readTimer: number | null = null
let activeList: HTMLElement | null = null
let scrollHandler: (() => void) | null = null
let presenceText = 'Solo tú'

const memberId = () => getIdentity()?.memberId || ''
const memberName = () => getIdentity()?.name || 'Familia'
const chatList = () => document.querySelector<HTMLElement>('#messages')
const chatOpen = () => !!document.querySelector('.chat-page')

function installStyle() {
  if (document.getElementById('chat-live-polish-style')) return
  const style = document.createElement('style')
  style.id = 'chat-live-polish-style'
  style.textContent = `
    .chat-reaction.is-mine{background:#171716;color:#fff}
    .chat-read-state{font-weight:700;letter-spacing:-.08em}
  `
  document.head.appendChild(style)
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
    await Promise.allSettled(ids.map(messageId =>
      supabase.rpc('mark_chat_message_read', { p_member_id: id, p_message_id: messageId })
    ))
  }
  await refreshReadReceipts()
}

async function refreshReadReceipts() {
  const id = memberId()
  const list = chatList()
  if (!id || !list) return

  const ownIds = Array.from(list.querySelectorAll<HTMLElement>('.bubble.mine[data-message-id]'))
    .map(el => el.dataset.messageId || '')
    .filter(Boolean)
  if (!ownIds.length) return

  const { data, error } = await supabase.rpc('get_chat_read_receipts', { p_message_ids: ownIds })
  if (error) return
  const read = new Set((data || [])
    .filter((row: any) => row.member_id !== id)
    .map((row: any) => row.message_id))

  list.querySelectorAll<HTMLElement>('.bubble.mine[data-message-id]').forEach(bubble => {
    const small = bubble.querySelector('small')
    if (!small) return
    let state = small.querySelector<HTMLElement>('.chat-read-state')
    const isRead = read.has(bubble.dataset.messageId || '')
    if (isRead) {
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

function scheduleReactionRefresh(delay = 90) {
  if (reactionRefreshTimer) window.clearTimeout(reactionRefreshTimer)
  reactionRefreshTimer = window.setTimeout(() => void refreshMyReactions(), delay)
}

async function refreshMyReactions() {
  const id = memberId()
  const list = chatList()
  if (!id || !list) return
  const messageIds = Array.from(list.querySelectorAll<HTMLElement>('.bubble[data-message-id]'))
    .map(el => el.dataset.messageId || '')
    .filter(Boolean)
  if (!messageIds.length) return

  const { data, error } = await supabase
    .from('chat_reactions')
    .select('message_id,reaction')
    .eq('member_id', id)
    .in('message_id', messageIds)
  if (error) return

  const mine = new Set((data || []).map((row: any) => `${row.message_id}:${row.reaction}`))
  list.querySelectorAll<HTMLElement>('.bubble[data-message-id]').forEach(bubble => {
    const messageId = bubble.dataset.messageId || ''
    bubble.querySelectorAll<HTMLButtonElement>('.chat-reaction[data-react]').forEach(button => {
      const active = mine.has(`${messageId}:${button.dataset.react || ''}`)
      button.classList.toggle('is-mine', active)
      button.setAttribute('aria-pressed', String(active))
      button.title = active ? 'Tu reacción' : 'Reaccionar'
    })
  })
}

function clearTypingLater() {
  if (typingExpiryTimer) window.clearTimeout(typingExpiryTimer)
  const typing = document.querySelector<HTMLElement>('#chatTyping')
  if (!typing?.textContent?.trim()) return
  typingExpiryTimer = window.setTimeout(() => {
    const current = document.querySelector<HTMLElement>('#chatTyping')
    if (current) current.textContent = ''
  }, 1800)
}

function attachTypingGuard() {
  typingObserver?.disconnect()
  typingObserver = null
  const typing = document.querySelector<HTMLElement>('#chatTyping')
  if (!typing) return
  typingObserver = new MutationObserver(clearTypingLater)
  typingObserver.observe(typing, { childList: true, characterData: true, subtree: true })
  clearTypingLater()
}

function computePresence() {
  const state = presenceChannel?.presenceState() as PresenceState | undefined
  const current = memberId()
  const unique = new Map<string, PresenceMeta>()
  Object.values(state || {}).flat().forEach(meta => {
    if (!meta.memberId || meta.memberId === current) return
    if (!unique.has(meta.memberId)) unique.set(meta.memberId, meta)
  })
  const people = Array.from(unique.values())
  presenceText = people.length === 0
    ? 'Solo tú'
    : people.length === 1
      ? `${people[0]?.name || '1 familiar'} en línea`
      : `${people.length} familiares en línea`
  enforcePresenceText()
}

function enforcePresenceText() {
  const el = document.querySelector<HTMLElement>('#chatPresence')
  if (el && el.textContent !== presenceText) el.textContent = presenceText
}

function attachPresenceGuard() {
  presenceObserver?.disconnect()
  presenceObserver = null
  const el = document.querySelector<HTMLElement>('#chatPresence')
  if (!el) return
  presenceObserver = new MutationObserver(() => {
    if (el.textContent !== presenceText) queueMicrotask(enforcePresenceText)
  })
  presenceObserver.observe(el, { childList: true, characterData: true, subtree: true })
  enforcePresenceText()
}

function handleChatMessage(event: Event) {
  const detail = (event as CustomEvent).detail as { type?: string; sender_id?: string } | undefined
  if (!detail || !chatOpen()) return
  const list = chatList()
  if (detail.type === 'insert' && detail.sender_id !== memberId() && list && isAtBottom(list)) scheduleMarkRead(40)
  window.setTimeout(() => {
    void refreshReadReceipts()
    scheduleReactionRefresh(0)
  }, 80)
}

function handleVisibility() {
  if (!started || document.visibilityState !== 'visible') return
  scheduleMarkRead(40)
  void refreshReadReceipts()
}

function start() {
  if (started || !chatOpen()) return
  const id = memberId()
  const list = chatList()
  if (!id || !list) return
  started = true
  activeList = list
  installStyle()

  scrollHandler = () => {
    if (isAtBottom(list)) scheduleMarkRead(120)
  }
  list.addEventListener('scroll', scrollHandler, { passive: true })

  listObserver = new MutationObserver(() => {
    scheduleReactionRefresh()
    void refreshReadReceipts()
    attachTypingGuard()
    attachPresenceGuard()
  })
  listObserver.observe(list, { childList: true, subtree: true })

  receiptChannel = supabase.channel(`familia-noa-chat-receipts-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_read_receipts' }, () => {
      void refreshReadReceipts()
    })
    .subscribe()

  presenceChannel = supabase.channel('familia-noa-chat-presence-v2', { config: { presence: { key: id } } })
    .on('presence', { event: 'sync' }, computePresence)
    .on('presence', { event: 'join' }, computePresence)
    .on('presence', { event: 'leave' }, computePresence)
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel?.track({ memberId: id, name: memberName(), onlineAt: new Date().toISOString() })
        computePresence()
      }
    })

  window.addEventListener('familia-noa:chat-message', handleChatMessage)
  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('focus', handleVisibility)

  attachTypingGuard()
  attachPresenceGuard()
  scheduleReactionRefresh(0)
  scheduleMarkRead(60)
  void refreshReadReceipts()
}

function stop() {
  if (!started) return
  started = false
  if (scrollHandler && activeList) activeList.removeEventListener('scroll', scrollHandler)
  scrollHandler = null
  activeList = null
  listObserver?.disconnect()
  listObserver = null
  typingObserver?.disconnect()
  typingObserver = null
  presenceObserver?.disconnect()
  presenceObserver = null
  if (typingExpiryTimer) window.clearTimeout(typingExpiryTimer)
  typingExpiryTimer = null
  if (reactionRefreshTimer) window.clearTimeout(reactionRefreshTimer)
  reactionRefreshTimer = null
  if (readTimer) window.clearTimeout(readTimer)
  readTimer = null
  window.removeEventListener('familia-noa:chat-message', handleChatMessage)
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('focus', handleVisibility)
  void receiptChannel?.unsubscribe()
  receiptChannel = null
  void presenceChannel?.untrack()
  void presenceChannel?.unsubscribe()
  presenceChannel = null
}

const pageObserver = new MutationObserver(() => {
  if (chatOpen()) start()
  else stop()
})
pageObserver.observe(document.body, { childList: true, subtree: true })
if (chatOpen()) start()

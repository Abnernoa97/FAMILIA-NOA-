import { supabase } from './supabase'
import { getIdentity } from './core/identity'

const esc = (v: string) => v.replace(/[&<>\\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#039;'}[c]!))
const time = (v: string) => new Date(v).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

type Row = {
  id: string
  sender_id: string
  body: string
  created_at: string
  reply_to_id: string | null
  attachment_path: string | null
  attachment_type: string | null
  attachment_name: string | null
  attachment_size: number | null
  deleted_at: string | null
  edited_at: string | null
}

type Member = { id: string; name: string }

let activeList: HTMLElement | null = null
let busy = false

function style() {
  if (document.getElementById('chat-data-repair-style')) return
  const s = document.createElement('style')
  s.id = 'chat-data-repair-style'
  s.textContent = `
    .chat-data-attachment{display:block;margin-top:8px;border-radius:14px;overflow:hidden;background:#e8e3da;color:#171716;text-decoration:none}
    .chat-data-attachment img{display:block;width:100%;max-height:320px;object-fit:cover}
    .chat-data-attachment span{display:block;padding:8px 10px;font-size:12px}
  `
  document.head.appendChild(s)
}

function bubble(m: Row, names: Map<string, string>, byId: Map<string, Row>) {
  const name = names.get(m.sender_id) || 'Familia'
  const deleted = !!m.deleted_at
  const body = deleted ? 'Mensaje eliminado' : m.body
  const reply = m.reply_to_id ? byId.get(m.reply_to_id) : null
  const quoted = reply ? `<button class="quoted" data-jump="${esc(reply.id)}"><b>${esc(names.get(reply.sender_id) || 'Familia')}</b><span>${esc(reply.deleted_at ? 'Mensaje eliminado' : reply.body)}</span></button>` : ''
  const url = m.attachment_path ? supabase.storage.from('family-photos').getPublicUrl(m.attachment_path).data.publicUrl : ''
  const attachment = !deleted && m.attachment_path && url
    ? `<a class="chat-data-attachment" href="${esc(url)}" target="_blank" rel="noreferrer">${(m.attachment_type || '').startsWith('image/') ? `<img src="${esc(url)}" alt="${esc(m.attachment_name || 'Foto')}" loading="lazy">` : ''}<span>📎 ${esc(m.attachment_name || 'Foto')}</span></a>`
    : ''
  const currentId = getIdentity()?.memberId || ''
  return `<article class="bubble ${m.sender_id === currentId ? 'mine' : ''}" data-message-id="${esc(m.id)}"><div class="swipe-hint" aria-hidden="true">↩</div>${quoted}<b class="sender-name">${esc(name)}</b><p>${esc(body)}</p>${attachment}<small>${time(m.created_at)}${m.edited_at ? ' · editado' : ''}</small></article>`
}

async function hydrate(list: HTMLElement) {
  if (busy || activeList === list) return
  busy = true
  style()
  const { data, error } = await supabase
    .from('messages')
    .select('id,sender_id,body,created_at,reply_to_id,attachment_path,attachment_type,attachment_name,attachment_size,deleted_at,edited_at')
    .order('created_at', { ascending: true })
    .limit(100)

  if (error || !data?.length) {
    busy = false
    return
  }

  const rows = data as Row[]
  const senderIds = [...new Set(rows.map(r => r.sender_id).filter(Boolean))]
  const { data: memberRows } = await supabase.from('family_members').select('id,name').in('id', senderIds)
  const names = new Map<string, string>((memberRows || []).map((m: Member) => [m.id, m.name]))
  const byId = new Map(rows.map(r => [r.id, r]))
  const currentCount = list.querySelectorAll('.bubble[data-message-id]').length
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 140

  if (currentCount < rows.length) {
    list.innerHTML = rows.map(r => bubble(r, names, byId)).join('')
    if (nearBottom || currentCount === 0) list.scrollTop = list.scrollHeight
  } else {
    for (const row of rows) {
      const el = list.querySelector<HTMLElement>(`[data-message-id="${row.id}"]`)
      if (!el) continue
      if (row.deleted_at) {
        const p = el.querySelector('p')
        if (p) p.textContent = 'Mensaje eliminado'
      }
      if (row.attachment_path && !row.deleted_at && !el.querySelector('.chat-data-attachment')) {
        const url = supabase.storage.from('family-photos').getPublicUrl(row.attachment_path).data.publicUrl
        if (url) {
          const link = document.createElement('a')
          link.className = 'chat-data-attachment'
          link.href = url
          link.target = '_blank'
          link.rel = 'noreferrer'
          link.innerHTML = `<img src="${esc(url)}" alt="${esc(row.attachment_name || 'Foto')}" loading="lazy"><span>📎 ${esc(row.attachment_name || 'Foto')}</span>`
          el.querySelector('p')?.after(link)
        }
      }
    }
  }

  activeList = list
  busy = false
}

function scan() {
  const list = document.querySelector<HTMLElement>('.chat-page #messages')
  if (!list) {
    activeList = null
    return
  }
  if (activeList !== list) {
    void hydrate(list)
    window.setTimeout(() => { if (document.querySelector('.chat-page #messages') === list && activeList !== list) void hydrate(list) }, 900)
  }
}

const observer = new MutationObserver(scan)
observer.observe(document.body, { childList: true, subtree: true })
scan()

import { supabase } from './supabase'
import { startChatFeatures } from './chat-features'
import { openMediaViewer, closeMediaViewer } from './core/media-viewer'
import { enterView, backView } from './core/navigation'
import { Outbox } from './core/outbox'
import { optimizePhoto } from './core/media-pipeline'
import { bindChatViewport } from './core/chat-viewport'

type ChatMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  reply_to_id: string | null
  edited_at: string | null
  deleted_at: string | null
  attachment_path: string | null
  attachment_type: string | null
  attachment_name: string | null
  attachment_size: number | null
  sender?: { name?: string } | null
}

type RawChatRow = Omit<ChatMessage, 'sender'>

type OpenChatOptions = {
  app: HTMLElement
  memberId: string
  memberName: string
  members: Array<{ id: string; name: string }>
  onBack: () => void
  notify: (title: string, text: string) => void
}

const PAGE_SIZE = 50
const MESSAGE_FIELDS = 'id,sender_id,body,created_at,reply_to_id,edited_at,deleted_at,attachment_path,attachment_type,attachment_name,attachment_size'
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))
const time = (value: string) => new Date(value).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })

let activeCleanup: (() => void) | null = null

function storageUrl(path: string) {
  return supabase.storage.from('family-photos').getPublicUrl(path).data.publicUrl
}

function quotedHtml(quoted: ChatMessage | null) {
  if (!quoted) return ''
  if (!quoted.deleted_at && quoted.attachment_path && (quoted.attachment_type || '').startsWith('image/')) {
    const src = storageUrl(quoted.attachment_path)
    return `<button type="button" class="chat-quoted image-only" data-jump="${esc(quoted.id)}"><img src="${esc(src)}" alt="Foto respondida" loading="lazy" decoding="async"></button>`
  }
  return `<button type="button" class="chat-quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name || 'Familia')}</b><span>${esc(quoted.deleted_at ? 'Mensaje eliminado' : quoted.body || 'Mensaje')}</span></button>`
}

function bubbleHtml(message: ChatMessage, quoted: ChatMessage | null, mine: boolean, priorityImage = false) {
  const deleted = !!message.deleted_at
  const isImage = !deleted && !!message.attachment_path && (message.attachment_type || '').startsWith('image/')
  const attachment = isImage
    ? `<button type="button" class="chat-attachment" data-chat-image="${esc(storageUrl(message.attachment_path!))}" aria-label="Ver foto"><img src="${esc(storageUrl(message.attachment_path!))}" alt="${esc(message.attachment_name || 'Foto')}" ${priorityImage ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async"></button>`
    : ''
  const body = deleted ? 'Mensaje eliminado' : message.body
  const bodyHtml = body ? `<p>${esc(body)}</p>` : ''
  return `<article class="chat-bubble${mine ? ' mine' : ''}${deleted ? ' deleted' : ''}" data-message-id="${esc(message.id)}">${quotedHtml(quoted)}<b class="chat-sender">${esc(message.sender?.name || 'Familia')}</b>${bodyHtml}${attachment}<small class="chat-meta">${time(message.created_at)}${message.edited_at ? ' · editado' : ''}</small></article>`
}

export function closeChat() {
  activeCleanup?.()
  activeCleanup = null
}

export async function openChat(options: OpenChatOptions) {
  closeChat()
  const { app, memberId, memberName, members, onBack, notify } = options
  const memberNames = new Map(members.map(member => [member.id, member.name]))
  let coreChannel: ReturnType<typeof supabase.channel> | null = null
  let features: ReturnType<typeof startChatFeatures> | null = null
  let all: ChatMessage[] = []
  const byId = new Map<string, ChatMessage>()
  const seenIds = new Set<string>()
  let oldestCreatedAt = ''
  let hasMore = true
  let loadingOlder = false
  let stickToLatest = true
  let closed = false
  type PendingText = { kind:'text'; id:string; body:string; replyToId:string|null; busy:boolean }
  type PendingPhoto = { kind:'photo'; id:string; file:File; objectUrl:string; replyToId:string|null; busy:boolean }
  type PendingJob = PendingText | PendingPhoto
  let outbox: Outbox<PendingJob>

  app.innerHTML = `<main class="chat-page"><button id="back" class="chat-native-back" type="button" aria-label="Volver"></button><section class="chat-messages" id="messages"><div class="chat-loading">Cargando mensajes…</div></section><div id="replyPreview"></div><form class="chat-composer" id="composer"><button class="chat-attach" id="chatAttach" type="button" aria-label="Adjuntar foto">＋</button><input id="chatAttachmentInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden><input id="message" maxlength="2000" placeholder="Escribe algo…" autocomplete="off"><button class="chat-send" type="submit">Enviar</button></form></main>`

  const page = app.querySelector<HTMLElement>('.chat-page')!
  const list = app.querySelector<HTMLElement>('#messages')!
  const composer = app.querySelector<HTMLFormElement>('#composer')!
  const input = app.querySelector<HTMLInputElement>('#message')!
  const preview = app.querySelector<HTMLElement>('#replyPreview')!
  const attach = app.querySelector<HTMLButtonElement>('#chatAttach')!
  const fileInput = app.querySelector<HTMLInputElement>('#chatAttachmentInput')!
  const back = app.querySelector<HTMLButtonElement>('#back')!

  const isAtBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 120
  const scrollLatest = () => {
    if (!list.isConnected) return
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
  }

  const onImageClick = (event:Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-image]')
    const src = button?.dataset.chatImage
    if (!src) return
    enterView('media')
    openMediaViewer([{ src, alt:'Foto del chat' }])
  }

  const unbindViewport = bindChatViewport(page, list, input, () => stickToLatest, scrollLatest)

  const nameRow = (row: RawChatRow): ChatMessage => ({ ...row, sender:{ name:memberNames.get(row.sender_id) || (row.sender_id === memberId ? memberName : 'Familia') } })

  const fetchPage = async (before?: string) => {
    let query = supabase.from('messages').select(MESSAGE_FIELDS).order('created_at', { ascending:false }).limit(PAGE_SIZE)
    if (before) query = query.lt('created_at', before)
    const { data, error } = await query
    if (error) throw error
    return ((data || []) as RawChatRow[]).reverse().map(nameRow)
  }

  const fetchMissingReplies = async (messages: ChatMessage[]) => {
    const ids = [...new Set(messages.map(message => message.reply_to_id).filter((id): id is string => !!id && !byId.has(id)))]
    if (!ids.length) return
    const { data, error } = await supabase.from('messages').select(MESSAGE_FIELDS).in('id', ids)
    if (error) return
    ;((data || []) as RawChatRow[]).map(nameRow).forEach(message => byId.set(message.id, message))
  }

  const elementFor = (id: string) => list.querySelector<HTMLElement>(`.chat-bubble[data-message-id="${CSS.escape(id)}"]`)

  const renderMessage = (message: ChatMessage, priorityImage = false) => bubbleHtml(message, message.reply_to_id ? byId.get(message.reply_to_id) || null : null, message.sender_id === memberId, priorityImage)

  const replaceMessageElement = (id: string) => {
    const message = byId.get(id)
    const current = elementFor(id)
    if (!message || !current) return
    current.outerHTML = renderMessage(message, true)
    const next = elementFor(id)
    if (next && features) {
      features.decorateMessage(next, message)
      features.onMessageUpdated(message)
    }
    if (stickToLatest) requestAnimationFrame(scrollLatest)
  }

  const applyLocalUpdate = (id: string, patch: Partial<ChatMessage>) => {
    const message = byId.get(id)
    if (!message) return
    const next = { ...message, ...patch }
    byId.set(id, next)
    const index = all.findIndex(item => item.id === id)
    if (index >= 0) all[index] = next
    replaceMessageElement(id)
  }

  const appendMessage = async (message: ChatMessage, forceBottom = false) => {
    if (byId.has(message.id)) return
    if (message.reply_to_id && !byId.has(message.reply_to_id)) await fetchMissingReplies([message])
    byId.set(message.id, message)
    seenIds.add(message.id)
    all.push(message)
    if (all.length > 100) {
      const removed = all.splice(0, all.length - 100)
      removed.forEach(item => {
        elementFor(item.id)?.remove()
        if (!all.some(loaded => loaded.reply_to_id === item.id)) byId.delete(item.id)
      })
    }
    list.querySelector('.chat-empty')?.remove()
    list.insertAdjacentHTML('beforeend', renderMessage(message, true))
    const bubble = elementFor(message.id)
    if (bubble && features) features.onMessageInserted(message)
    if (forceBottom || stickToLatest || message.sender_id === memberId) {
      stickToLatest = true
      requestAnimationFrame(scrollLatest)
    }
  }

  const renderInitial = async () => {
    try {
      all = await fetchPage()
      all.forEach(message => {
        byId.set(message.id, message)
        seenIds.add(message.id)
      })
      await fetchMissingReplies(all)
      if (closed) return
      oldestCreatedAt = all[0]?.created_at || ''
      hasMore = all.length === PAGE_SIZE
      list.innerHTML = all.length
        ? all.map((message, index) => renderMessage(message, index >= all.length - 4)).join('')
        : '<div class="chat-empty">Todavía no hay mensajes. Sé el primero ❤️</div>'

      features = startChatFeatures({
        list,
        composer,
        input,
        preview,
        memberId,
        getMessage:id => byId.get(id),
        getMessages:() => all,
        imageUrl:storageUrl,
        isAtBottom,
        scrollLatest,
        applyLocalUpdate
      })

      scrollLatest()
      requestAnimationFrame(() => {
        scrollLatest()
        list.classList.add('is-ready')
      })
    } catch (error) {
      console.error('Chat history load failed', error)
      list.innerHTML = '<div class="chat-empty">No se pudieron cargar los mensajes. Inténtalo de nuevo.</div>'
      list.classList.add('is-ready')
    }
  }

  const loadOlder = async () => {
    if (loadingOlder || !hasMore || !oldestCreatedAt || closed) return
    loadingOlder = true
    const previousHeight = list.scrollHeight
    const previousTop = list.scrollTop
    try {
      const older = await fetchPage(oldestCreatedAt)
      if (!older.length) { hasMore = false; return }
      older.forEach(message => byId.set(message.id, message))
      await fetchMissingReplies(older)
      all = [...older, ...all]
      oldestCreatedAt = all[0]?.created_at || oldestCreatedAt
      hasMore = older.length === PAGE_SIZE
      const html = older.map(message => renderMessage(message)).join('')
      list.insertAdjacentHTML('afterbegin', html)
      features?.onMessagesPrepended(older.map(message => message.id))
      list.scrollTop = list.scrollHeight - previousHeight + previousTop
    } catch (error) {
      console.error('Older Chat history load failed', error)
    } finally {
      loadingOlder = false
    }
  }

  const onScroll = () => {
    stickToLatest = isAtBottom()
    if (list.scrollTop <= 60) void loadOlder()
  }

  const onFocus = () => {
    stickToLatest = true
    requestAnimationFrame(scrollLatest)
  }

  const pendingTextElement = (id:string) => list.querySelector<HTMLElement>(`[data-pending-text-id="${CSS.escape(id)}"]`)

  const renderPendingText = (job:PendingText) => {
    const quoted = job.replyToId ? byId.get(job.replyToId) || null : null
    list.querySelector('.chat-empty')?.remove()
    list.insertAdjacentHTML('beforeend', `<article class="chat-bubble mine chat-pending" data-pending-text-id="${job.id}">${quotedHtml(quoted)}<p>${esc(job.body)}</p><small class="chat-meta" data-pending-text-state><span class="chat-spinner"></span> Enviando…</small></article>`)
    stickToLatest = true
    requestAnimationFrame(scrollLatest)
  }

  const setPendingTextState = (id:string, state:'sending'|'error') => {
    const meta = pendingTextElement(id)?.querySelector<HTMLElement>('[data-pending-text-state]')
    if (!meta) return
    meta.innerHTML = state === 'sending'
      ? '<span class="chat-spinner"></span> Enviando…'
      : '<button type="button" class="chat-retry" data-retry-text>Reintentar</button> · No enviado'
  }

  const sendTextJob = async (job:PendingText) => {
    setPendingTextState(job.id, 'sending')
    const payload:Record<string,unknown> = { sender_id:memberId, body:job.body }
    if (job.replyToId) payload.reply_to_id = job.replyToId
    try {
      const { data, error } = await supabase.from('messages').insert(payload).select(MESSAGE_FIELDS).single()
      if (error || !data) throw error || new Error('Message insert failed')
      pendingTextElement(job.id)?.remove()
      outbox.done(job.id)
      const message = nameRow(data as RawChatRow)
      if (!byId.has(message.id)) await appendMessage(message, true)
      else scrollLatest()
    } catch (error) {
      console.error('Chat text send failed', error)
      setPendingTextState(job.id, 'error')
      throw error
    }
  }

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    const body = input.value.trim()
    if (!body || !memberId) return
    const job:PendingText = {
      kind:'text',
      id:`pending-text-${crypto.randomUUID()}`,
      body,
      replyToId:features?.getReplyToId() || null,
      busy:false
    }
    input.value = ''
    features?.clearReply()
    renderPendingText(job)
    outbox.add(job)
    input.focus()
  }

  const pendingPhoto = (job: PendingPhoto) => {
    list.querySelector('.chat-empty')?.remove()
    list.insertAdjacentHTML('beforeend', `<article class="chat-bubble mine chat-pending" data-pending-id="${job.id}"><a class="chat-attachment"><img src="${esc(job.objectUrl)}" alt="Foto" decoding="async"></a><small class="chat-meta" data-pending-state><span class="chat-spinner"></span> Enviando…</small></article>`)
    stickToLatest = true
    requestAnimationFrame(scrollLatest)
  }

  const pendingElement = (id:string) => list.querySelector<HTMLElement>(`[data-pending-id="${CSS.escape(id)}"]`)

  const setPendingState = (id:string, state:'sending'|'error') => {
    const pending = pendingElement(id)
    const meta = pending?.querySelector<HTMLElement>('[data-pending-state]')
    if (!meta) return
    meta.innerHTML = state === 'sending'
      ? '<span class="chat-spinner"></span> Enviando…'
      : '<button type="button" class="chat-retry" data-retry-photo>Reintentar</button> · No enviado'
  }

  const sendPhotoJob = async (job: PendingPhoto) => {
    setPendingState(job.id, 'sending')
    let path = ''
    try {
      const optimized = await optimizePhoto(job.file)
      path = `chat/${memberId}/${crypto.randomUUID()}.${optimized.ext}`
      const { error: uploadError } = await supabase.storage.from('family-photos').upload(path, optimized.blob, {
        contentType:optimized.type, cacheControl:'31536000', upsert:false
      })
      if (uploadError) throw uploadError
      const { data, error:insertError } = await supabase.from('messages').insert({
        sender_id:memberId, body:'', attachment_path:path, attachment_type:optimized.type,
        attachment_name:optimized.name, attachment_size:optimized.blob.size, reply_to_id:job.replyToId
      }).select(MESSAGE_FIELDS).single()
      if (insertError || !data) {
        await supabase.storage.from('family-photos').remove([path])
        throw insertError || new Error('Message insert failed')
      }
      pendingElement(job.id)?.remove()
      outbox.done(job.id)
      URL.revokeObjectURL(job.objectUrl)
      if (job.replyToId === features?.getReplyToId()) features?.clearReply()
      const message = nameRow(data as RawChatRow)
      if (!byId.has(message.id)) await appendMessage(message, true)
      else scrollLatest()
    } catch (error) {
      console.error('Chat photo send failed', error)
      setPendingState(job.id, 'error')
      throw error
    }
  }

  outbox = new Outbox<PendingJob>(job => job.kind === 'text' ? sendTextJob(job) : sendPhotoJob(job))

  const onPhoto = () => {
    const files = Array.from(fileInput.files || [])
    fileInput.value = ''
    for (const file of files) {
      if (!file.type.startsWith('image/')) { notify('Archivo no compatible', 'Selecciona una imagen.'); continue }
      if (file.type === 'image/gif') { notify('GIF no compatible', 'Envía una foto JPG, PNG, WebP o HEIC.'); continue }
      if (file.size > 15 * 1024 * 1024) { notify('Foto demasiado grande', 'La foto debe pesar menos de 15 MB.'); continue }
      const job: PendingPhoto = {
        kind:'photo',
        id:`pending-${crypto.randomUUID()}`,
        file,
        objectUrl:URL.createObjectURL(file),
        replyToId:features?.getReplyToId() || null,
        busy:false
      }
      pendingPhoto(job)
      outbox.add(job)
    }
  }

  const onPendingClick = (event:Event) => {
    const target = event.target as HTMLElement
    const photoButton = target.closest<HTMLElement>('[data-retry-photo]')
    if (photoButton) {
      const pending = photoButton.closest<HTMLElement>('[data-pending-id]')
      const job = pending?.dataset.pendingId ? photoQueue.get(pending.dataset.pendingId) : null
      if (job) void sendPhotoJob(job)
      return
    }
    const textButton = target.closest<HTMLElement>('[data-retry-text]')
    if (textButton) {
      const pending = textButton.closest<HTMLElement>('[data-pending-text-id]')
      const job = pending?.dataset.pendingTextId ? textQueue.get(pending.dataset.pendingTextId) : null
      if (job) void sendTextJob(job)
    }
  }



  coreChannel = supabase.channel(`familia-noa-chat-core-${memberId}`)
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
      const row = payload.new as RawChatRow
      if (!row?.id || seenIds.has(row.id) || closed) return
      void appendMessage(nameRow(row), false)
    })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'messages' }, payload => {
      const row = payload.new as RawChatRow
      if (!row?.id || !byId.has(row.id) || closed) return
      const current = byId.get(row.id)!
      const next = { ...current, ...row, sender:current.sender }
      byId.set(row.id, next)
      const index = all.findIndex(message => message.id === row.id)
      if (index >= 0) all[index] = next
      replaceMessageElement(row.id)
    })
    .subscribe()

  activeCleanup = () => {
    closed = true
    features?.cleanup()
    features = null
    void coreChannel?.unsubscribe()
    coreChannel = null
    back.removeEventListener('click', backView)
    list.removeEventListener('scroll', onScroll)
    input.removeEventListener('focus', onFocus)
    composer.removeEventListener('submit', onSubmit)
    fileInput.removeEventListener('change', onPhoto)
    list.removeEventListener('click', onPendingClick)
    list.removeEventListener('click', onImageClick)
    closeMediaViewer()
    outbox.clear(job => { if (job.kind === 'photo') URL.revokeObjectURL(job.objectUrl) })
    unbindViewport()
  }

  await renderInitial()
}

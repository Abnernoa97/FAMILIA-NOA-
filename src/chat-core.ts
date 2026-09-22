import { supabase } from './supabase'
import { startChatFeatures } from './chat-features'
import { openMediaViewer, closeMediaViewer } from './core/media-viewer'
import { enterView, backView } from './core/navigation'
import { Outbox } from './core/outbox'
import { optimizePhoto, prepareVideo, prepareAudio, isSupportedVideo, isSupportedAudio, CHAT_VIDEO_MAX_BYTES, CHAT_AUDIO_MAX_BYTES } from './core/media-pipeline'
import { bindChatViewport } from './core/chat-viewport'
import { mediaUrl, primeMedia, signMedia } from './core/private-media'
import { beginVoiceRecording, canRecordVoice, type VoiceRecorderSession } from './core/voice-recorder'

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
  notify: (title: string, text: string) => void
}

type PreparedMedia = { blob:Blob; type:string; name:string; ext:string }
type MediaKind = 'image'|'video'|'audio'

const PAGE_SIZE = 50
const MAX_LOADED_MESSAGES = 100
const MAX_IMAGE_SOURCE_BYTES = 15 * 1024 * 1024
const MESSAGE_FIELDS = 'id,sender_id,body,created_at,reply_to_id,edited_at,deleted_at,attachment_path,attachment_type,attachment_name,attachment_size'
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))
const time = (value: string) => new Date(value).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })
const mediaTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${String(safe % 60).padStart(2, '0')}`
}
const compareMessages = (a: ChatMessage, b: ChatMessage) => {
  const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  return byTime || a.id.localeCompare(b.id)
}
const orderMessages = (messages: ChatMessage[]) => [...messages].sort(compareMessages)
const isImageMessage = (message:ChatMessage) => !!message.attachment_path && (message.attachment_type || '').startsWith('image/')
const isVideoMessage = (message:ChatMessage) => !!message.attachment_path && (message.attachment_type || '').startsWith('video/')
const isAudioMessage = (message:ChatMessage) => !!message.attachment_path && (message.attachment_type || '').startsWith('audio/')
const isVoiceMessage = (message:ChatMessage) => isAudioMessage(message) && (message.attachment_name || '').startsWith('voz-')

let activeCleanup: (() => void) | null = null

function storageUrl(path: string) {
  return mediaUrl(path)
}

function audioPlayerHtml(src:string, label:string) {
  return `<div class="chat-attachment chat-audio"><button type="button" class="chat-audio-toggle" aria-label="Reproducir ${esc(label)}">▶</button><div class="chat-audio-track" data-audio-seek><span class="chat-audio-progress"></span></div><span class="chat-audio-time">0:00</span><audio class="chat-audio-player" src="${esc(src)}" preload="metadata" aria-label="${esc(label)}"></audio></div>`
}

function quotedHtml(quoted: ChatMessage | null) {
  if (!quoted) return ''
  if (quoted.deleted_at) {
    return `<button type="button" class="chat-quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name || 'Familia')}</b><span>Mensaje eliminado</span></button>`
  }
  if (isImageMessage(quoted)) {
    const src = storageUrl(quoted.attachment_path!)
    if (src) return `<button type="button" class="chat-quoted image-only" data-jump="${esc(quoted.id)}"><img src="${esc(src)}" alt="Foto respondida" loading="lazy" decoding="async"></button>`
    return `<button type="button" class="chat-quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name || 'Familia')}</b><span>📷 Foto</span></button>`
  }
  if (isVideoMessage(quoted)) {
    return `<button type="button" class="chat-quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name || 'Familia')}</b><span>Video</span></button>`
  }
  if (isAudioMessage(quoted)) {
    return `<button type="button" class="chat-quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name || 'Familia')}</b><span>${isVoiceMessage(quoted) ? 'Mensaje de voz' : 'Audio'}</span></button>`
  }
  return `<button type="button" class="chat-quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name || 'Familia')}</b><span>${esc(quoted.body || 'Mensaje')}</span></button>`
}

function attachmentHtml(message:ChatMessage, priorityMedia=false){
  if(message.deleted_at||!message.attachment_path)return ''
  const src=storageUrl(message.attachment_path)
  if(!src)return '<div class="chat-media-unavailable">Archivo no disponible por ahora</div>'

  if(isImageMessage(message)){
    return `<button type="button" class="chat-attachment" data-chat-image="${esc(src)}" aria-label="Ver foto"><img src="${esc(src)}" alt="${esc(message.attachment_name || 'Foto')}" ${priorityMedia ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async"></button>`
  }
  if(isVideoMessage(message)){
    return `<div class="chat-attachment chat-video"><video class="chat-video-player" src="${esc(src)}" playsinline ${priorityMedia ? 'preload="metadata"' : 'preload="none"'} aria-label="${esc(message.attachment_name || 'Video')}"></video></div>`
  }
  if(isAudioMessage(message)){
    return audioPlayerHtml(src, isVoiceMessage(message) ? 'mensaje de voz' : (message.attachment_name || 'audio'))
  }
  return ''
}

function bubbleHtml(message: ChatMessage, quoted: ChatMessage | null, mine: boolean, priorityMedia = false) {
  const deleted = !!message.deleted_at
  const body = deleted ? 'Mensaje eliminado' : message.body
  const bodyHtml = body ? `<p>${esc(body)}</p>` : ''
  return `<article class="chat-bubble${mine ? ' mine' : ''}${deleted ? ' deleted' : ''}" data-message-id="${esc(message.id)}">${quotedHtml(quoted)}<b class="chat-sender">${esc(message.sender?.name || 'Familia')}</b>${bodyHtml}${attachmentHtml(message,priorityMedia)}<small class="chat-meta">${time(message.created_at)}${message.edited_at ? ' · editado' : ''}</small></article>`
}

export function closeChat() {
  activeCleanup?.()
  activeCleanup = null
}

export async function openChat(options: OpenChatOptions) {
  closeChat()
  const { app, memberId, memberName, members, notify } = options
  const memberNames = new Map(members.map(member => [member.id, member.name]))
  let coreChannel: ReturnType<typeof supabase.channel> | null = null
  let features: ReturnType<typeof startChatFeatures> | null = null
  let all: ChatMessage[] = []
  const byId = new Map<string, ChatMessage>()
  let oldestCreatedAt = ''
  let hasMore = true
  let loadingOlder = false
  let stickToLatest = true
  let closed = false
  let voiceSession: VoiceRecorderSession | null = null
  let voiceTimer: number | null = null
  let voiceBusy = false
  type PendingText = { kind:'text'; id:string; body:string; replyToId:string|null; busy:boolean }
  type PendingMedia = { kind:'media'; mediaKind:MediaKind; id:string; file:File; objectUrl:string; replyToId:string|null; busy:boolean }
  type PendingJob = PendingText | PendingMedia
  let outbox: Outbox<PendingJob>

  app.innerHTML = `<main class="chat-page"><button id="back" class="chat-native-back" type="button" aria-label="Volver"></button><section class="chat-messages" id="messages"><div class="chat-loading">Cargando mensajes…</div></section><div id="replyPreview"></div><form class="chat-composer" id="composer"><button class="chat-attach" id="chatAttach" type="button" aria-label="Adjuntar" aria-expanded="false">＋</button><div class="chat-attach-menu" id="chatAttachMenu" hidden><button type="button" data-attach-kind="image"><span>📷</span>Foto</button><button type="button" data-attach-kind="video"><span>🎬</span>Video</button><button type="button" data-attach-kind="audio"><span>🎵</span>Audio</button></div><input id="chatAttachmentInput" type="file" hidden><input id="message" maxlength="2000" placeholder="Escribe algo…" autocomplete="off"><button class="chat-voice" id="chatVoice" type="button" aria-label="Grabar mensaje de voz"><span aria-hidden="true">●</span></button><button class="chat-send" type="submit">Enviar</button><div class="chat-voice-recording" id="chatVoiceRecording" hidden><button type="button" class="chat-voice-cancel" data-voice-cancel>Cancelar</button><div class="chat-voice-live"><span class="chat-voice-dot"></span><span id="chatVoiceTime">0:00</span></div><button type="button" class="chat-voice-finish" data-voice-send>Enviar</button></div></form></main>`

  const page = app.querySelector<HTMLElement>('.chat-page')!
  const list = app.querySelector<HTMLElement>('#messages')!
  const composer = app.querySelector<HTMLFormElement>('#composer')!
  const input = app.querySelector<HTMLInputElement>('#message')!
  const preview = app.querySelector<HTMLElement>('#replyPreview')!
  const attach = app.querySelector<HTMLButtonElement>('#chatAttach')!
  const attachMenu = app.querySelector<HTMLElement>('#chatAttachMenu')!
  const fileInput = app.querySelector<HTMLInputElement>('#chatAttachmentInput')!
  const voiceButton = app.querySelector<HTMLButtonElement>('#chatVoice')!
  const voiceRecording = app.querySelector<HTMLElement>('#chatVoiceRecording')!
  const voiceTime = app.querySelector<HTMLElement>('#chatVoiceTime')!
  const voiceCancel = app.querySelector<HTMLButtonElement>('[data-voice-cancel]')!
  const voiceSend = app.querySelector<HTMLButtonElement>('[data-voice-send]')!
  const back = app.querySelector<HTMLButtonElement>('#back')!

  const isAtBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 120
  const scrollLatest = () => {
    if (!list.isConnected) return
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight)
  }
  const scheduleLatest = () => requestAnimationFrame(scrollLatest)
  const elementFor = (id: string) => list.querySelector<HTMLElement>(`.chat-bubble[data-message-id="${CSS.escape(id)}"]`)

  const onImageClick = (event:Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-image]')
    const src = button?.dataset.chatImage
    if (!src) return
    enterView('media')
    openMediaViewer([{ src, alt:'Foto del chat' }])
  }

  const onVideoClick = (event:Event) => {
    const video = (event.target as HTMLElement).closest<HTMLVideoElement>('.chat-video-player')
    if (!video) return
    event.preventDefault()
    event.stopPropagation()
    if (video.ended) video.currentTime = 0
    if (video.paused) void video.play().catch(error => console.error('Chat video play failed', error))
    else video.pause()
  }

  const syncAudioUi = (audio:HTMLAudioElement) => {
    const shell = audio.closest<HTMLElement>('.chat-audio')
    if (!shell) return
    const toggle = shell.querySelector<HTMLButtonElement>('.chat-audio-toggle')
    const progress = shell.querySelector<HTMLElement>('.chat-audio-progress')
    const clock = shell.querySelector<HTMLElement>('.chat-audio-time')
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0
    if (toggle) toggle.textContent = audio.paused ? '▶' : '❚❚'
    if (progress) progress.style.width = duration > 0 ? `${Math.min(100, Math.max(0, audio.currentTime / duration * 100))}%` : '0%'
    if (clock) clock.textContent = mediaTime(audio.currentTime || duration)
  }

  const onAudioClick = (event:Event) => {
    const target = event.target as HTMLElement
    const shell = target.closest<HTMLElement>('.chat-audio')
    const audio = shell?.querySelector<HTMLAudioElement>('.chat-audio-player')
    if (!shell || !audio) return

    if (target.closest('.chat-audio-toggle')) {
      event.preventDefault()
      event.stopPropagation()
      if (audio.ended) audio.currentTime = 0
      if (audio.paused) void audio.play().catch(error => console.error('Chat audio play failed', error))
      else audio.pause()
      return
    }

    const track = target.closest<HTMLElement>('[data-audio-seek]')
    if (track && Number.isFinite(audio.duration) && audio.duration > 0) {
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, ((event as MouseEvent).clientX - rect.left) / rect.width))
      audio.currentTime = ratio * audio.duration
      syncAudioUi(audio)
    }
  }

  const onAudioState = (event:Event) => {
    const audio = event.target as HTMLAudioElement
    if (!(audio instanceof HTMLAudioElement) || !audio.classList.contains('chat-audio-player')) return
    if (event.type === 'play') {
      list.querySelectorAll<HTMLAudioElement>('.chat-audio-player').forEach(other => {
        if (other !== audio && !other.paused) other.pause()
      })
    }
    syncAudioUi(audio)
  }

  const unbindViewport = bindChatViewport(page, list, input, () => stickToLatest, scrollLatest)
  const nameRow = (row: RawChatRow): ChatMessage => ({ ...row, sender:{ name:memberNames.get(row.sender_id) || (row.sender_id === memberId ? memberName : 'Familia') } })

  const fetchPage = async (before?: string) => {
    const { data, error } = await supabase.rpc('get_chat_messages', { p_before: before || null, p_limit: PAGE_SIZE })
    if (error) throw error
    const rows=orderMessages(((data || []) as RawChatRow[]).map(nameRow))
    await primeMedia(rows.map(row=>row.attachment_path))
    return rows
  }

  const fetchMissingReplies = async (messages: ChatMessage[]) => {
    const ids = [...new Set(messages.map(message => message.reply_to_id).filter((id): id is string => !!id && !byId.has(id)))]
    if (!ids.length) return
    const { data, error } = await supabase.from('messages').select(MESSAGE_FIELDS).in('id', ids)
    if (error) return
    const replies=((data || []) as RawChatRow[]).map(nameRow)
    await primeMedia(replies.map(row=>row.attachment_path))
    replies.forEach(message => byId.set(message.id, message))
  }

  const renderMessage = (message: ChatMessage, priorityMedia = false) => bubbleHtml(message, message.reply_to_id ? byId.get(message.reply_to_id) || null : null, message.sender_id === memberId, priorityMedia)

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
    if (stickToLatest) scheduleLatest()
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
    all = orderMessages([...all, message])
    if (all.length > MAX_LOADED_MESSAGES) {
      const removed = all.splice(0, all.length - MAX_LOADED_MESSAGES)
      removed.forEach(item => {
        elementFor(item.id)?.remove()
        if (!all.some(loaded => loaded.reply_to_id === item.id)) byId.delete(item.id)
      })
    }
    if (!all.some(item => item.id === message.id)) return
    list.querySelector('.chat-empty')?.remove()
    const messageIndex = all.findIndex(item => item.id === message.id)
    const nextMessage = all[messageIndex + 1]
    const nextElement = nextMessage ? elementFor(nextMessage.id) : null
    if (nextElement) nextElement.insertAdjacentHTML('beforebegin', renderMessage(message, true))
    else list.insertAdjacentHTML('beforeend', renderMessage(message, true))
    const bubble = elementFor(message.id)
    if (bubble && features) features.onMessageInserted(message)
    if (forceBottom || stickToLatest || message.sender_id === memberId) {
      stickToLatest = true
      scheduleLatest()
    }
  }

  const renderInitial = async () => {
    try {
      all = orderMessages(await fetchPage())
      all.forEach(message => byId.set(message.id, message))
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
      void document.fonts?.ready.then(() => {
        if (!closed && stickToLatest) scheduleLatest()
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
      all = orderMessages([...older, ...all])
      oldestCreatedAt = all[0]?.created_at || oldestCreatedAt
      hasMore = older.length === PAGE_SIZE
      list.insertAdjacentHTML('afterbegin', older.map(message => renderMessage(message)).join(''))
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

  const pendingTextElement = (id:string) => list.querySelector<HTMLElement>(`[data-pending-text-id="${CSS.escape(id)}"]`)
  const renderPendingText = (job:PendingText) => {
    const quoted = job.replyToId ? byId.get(job.replyToId) || null : null
    list.querySelector('.chat-empty')?.remove()
    list.insertAdjacentHTML('beforeend', `<article class="chat-bubble mine chat-pending" data-pending-text-id="${job.id}">${quotedHtml(quoted)}<p>${esc(job.body)}</p><small class="chat-meta" data-pending-text-state><span class="chat-spinner"></span> Enviando…</small></article>`)
    stickToLatest = true
    scheduleLatest()
  }

  const setPendingTextState = (id:string, state:'sending'|'error') => {
    const meta = pendingTextElement(id)?.querySelector<HTMLElement>('[data-pending-text-state]')
    if (!meta) return
    meta.innerHTML = state === 'sending'
      ? '<span class="chat-spinner"></span> Enviando…'
      : '<button type="button" class="chat-retry" data-retry-text>Reintentar</button> · No enviado'
  }

  const existingMessage = async (id:string) => {
    const { data, error } = await supabase.from('messages').select(MESSAGE_FIELDS).eq('id', id).maybeSingle()
    if (error) throw error
    return data ? nameRow(data as RawChatRow) : null
  }

  const finishPendingText = async (job:PendingText, message:ChatMessage) => {
    pendingTextElement(job.id)?.remove()
    outbox.done(job.id)
    if (!byId.has(message.id)) await appendMessage(message, true)
    else scrollLatest()
  }

  const sendTextJob = async (job:PendingText) => {
    setPendingTextState(job.id, 'sending')
    const payload:Record<string,unknown> = { id:job.id, sender_id:memberId, body:job.body }
    if (job.replyToId) payload.reply_to_id = job.replyToId
    try {
      const { data, error } = await supabase.from('messages').insert(payload).select(MESSAGE_FIELDS).single()
      if (error || !data) throw error || new Error('Message insert failed')
      await finishPendingText(job, nameRow(data as RawChatRow))
    } catch (error) {
      try {
        const existing = await existingMessage(job.id)
        if (existing) { await finishPendingText(job, existing); return }
      } catch (lookupError) {
        console.error('Chat text reconciliation failed', lookupError)
      }
      console.error('Chat text send failed', error)
      setPendingTextState(job.id, 'error')
      throw error
    }
  }

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    const body = input.value.trim()
    if (!body || !memberId || voiceSession) return
    const job:PendingText = { kind:'text', id:crypto.randomUUID(), body, replyToId:features?.getReplyToId() || null, busy:false }
    input.value = ''
    features?.clearReply()
    renderPendingText(job)
    void outbox.add(job)
    input.focus()
  }

  const pendingElement = (id:string) => list.querySelector<HTMLElement>(`[data-pending-id="${CSS.escape(id)}"]`)
  const renderPendingMedia = (job: PendingMedia) => {
    list.querySelector('.chat-empty')?.remove()
    const previewHtml = job.mediaKind === 'video'
      ? `<div class="chat-attachment chat-video"><video class="chat-video-player" src="${esc(job.objectUrl)}" playsinline preload="metadata"></video></div>`
      : job.mediaKind === 'audio'
        ? audioPlayerHtml(job.objectUrl, job.file.name.startsWith('voz-') ? 'mensaje de voz' : 'audio')
        : `<div class="chat-attachment"><img src="${esc(job.objectUrl)}" alt="Foto" decoding="async"></div>`
    const label = job.mediaKind === 'video' ? 'Enviando video…' : job.mediaKind === 'audio' ? 'Enviando audio…' : 'Enviando foto…'
    list.insertAdjacentHTML('beforeend', `<article class="chat-bubble mine chat-pending" data-pending-id="${job.id}">${previewHtml}<small class="chat-meta" data-pending-state><span class="chat-spinner"></span> ${label}</small></article>`)
    stickToLatest = true
    scheduleLatest()
  }

  const setPendingMediaState = (id:string, state:'sending'|'error') => {
    const meta = pendingElement(id)?.querySelector<HTMLElement>('[data-pending-state]')
    if (!meta) return
    meta.innerHTML = state === 'sending'
      ? '<span class="chat-spinner"></span> Enviando…'
      : '<button type="button" class="chat-retry" data-retry-media>Reintentar</button> · No enviado'
  }

  const prepareJobMedia = async (job:PendingMedia):Promise<PreparedMedia> => {
    if (job.mediaKind === 'image') return optimizePhoto(job.file)
    if (job.mediaKind === 'video') return prepareVideo(job.file)
    return prepareAudio(job.file)
  }

  const finishPendingMedia = async (job:PendingMedia, message:ChatMessage) => {
    if (message.attachment_path) await signMedia(message.attachment_path)
    pendingElement(job.id)?.remove()
    outbox.done(job.id)
    URL.revokeObjectURL(job.objectUrl)
    if (job.replyToId === features?.getReplyToId()) features?.clearReply()
    if (!byId.has(message.id)) await appendMessage(message, true)
    else scrollLatest()
  }

  const sendMediaJob = async (job: PendingMedia) => {
    setPendingMediaState(job.id, 'sending')
    let path = ''
    try {
      const alreadySent = await existingMessage(job.id)
      if (alreadySent) { await finishPendingMedia(job, alreadySent); return }

      const prepared = await prepareJobMedia(job)
      path = `chat/${memberId}/${job.id}.${prepared.ext}`
      const { error:uploadError } = await supabase.storage.from('family-photos').upload(path, prepared.blob, {
        contentType:prepared.type,
        cacheControl:'31536000',
        upsert:true
      })
      if (uploadError) throw uploadError

      const { data, error:insertError } = await supabase.from('messages').insert({
        id:job.id,
        sender_id:memberId,
        body:'',
        attachment_path:path,
        attachment_type:prepared.type,
        attachment_name:prepared.name,
        attachment_size:prepared.blob.size,
        reply_to_id:job.replyToId
      }).select(MESSAGE_FIELDS).single()

      if (insertError || !data) {
        let existing:ChatMessage|null = null
        try { existing = await existingMessage(job.id) }
        catch (lookupError) {
          console.error('Chat media reconciliation failed', lookupError)
          throw insertError || new Error('Message insert failed')
        }
        if (existing) { await finishPendingMedia(job, existing); return }
        if (path) await supabase.storage.from('family-photos').remove([path])
        throw insertError || new Error('Message insert failed')
      }

      await finishPendingMedia(job, nameRow(data as RawChatRow))
    } catch (error:any) {
      console.error('Chat media send failed', error)
      setPendingMediaState(job.id, 'error')
      const message=String(error?.message||'')
      if(message.includes('FAMILY_PHOTOS_STORAGE_CAP_REACHED')) notify('Almacenamiento protegido', 'Se alcanzó el límite interno de almacenamiento de la familia.')
      throw error
    }
  }

  outbox = new Outbox<PendingJob>(job => job.kind === 'text' ? sendTextJob(job) : sendMediaJob(job), `chat:${memberId}`)

  const configurePicker = (kind:MediaKind) => {
    fileInput.value = ''
    fileInput.dataset.mediaKind = kind
    fileInput.accept = kind === 'image'
      ? 'image/jpeg,image/png,image/webp,image/heic'
      : kind === 'video'
        ? 'video/mp4,video/webm,video/quicktime,video/x-m4v'
        : 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/webm,audio/ogg'
  }

  const closeAttachMenu = () => {
    attachMenu.hidden = true
    attach.setAttribute('aria-expanded','false')
  }

  const onAttachClick = () => {
    if (voiceSession) return
    const next = !attachMenu.hidden
    attachMenu.hidden = next
    attach.setAttribute('aria-expanded', next ? 'false' : 'true')
  }

  const onAttachMenuClick = (event:Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-attach-kind]')
    const kind = button?.dataset.attachKind as MediaKind|undefined
    if (!kind) return
    configurePicker(kind)
    closeAttachMenu()
    fileInput.click()
  }

  const onDocumentPointer = (event:PointerEvent) => {
    const target = event.target as Node
    if (!attachMenu.hidden && !attachMenu.contains(target) && !attach.contains(target)) closeAttachMenu()
  }

  const onAttachment = () => {
    const files = Array.from(fileInput.files || [])
    const requestedKind = fileInput.dataset.mediaKind as MediaKind|undefined
    fileInput.value = ''
    delete fileInput.dataset.mediaKind

    for (const file of files) {
      const type=file.type.toLowerCase()
      const isImage=requestedKind === 'image' || type.startsWith('image/')
      const isVideo=requestedKind === 'video' || type.startsWith('video/') || isSupportedVideo(file)
      const isAudio=requestedKind === 'audio' || type.startsWith('audio/') || isSupportedAudio(file)
      let mediaKind:MediaKind

      if (isImage && requestedKind !== 'video' && requestedKind !== 'audio') {
        mediaKind='image'
        if (type === 'image/gif') { notify('GIF no compatible', 'Envía una foto JPG, PNG, WebP o HEIC.'); continue }
        if (file.size > MAX_IMAGE_SOURCE_BYTES) { notify('Foto demasiado grande', 'La foto debe pesar menos de 15 MB.'); continue }
      } else if (isVideo && requestedKind !== 'audio') {
        mediaKind='video'
        if (!isSupportedVideo(file)) { notify('Video no compatible', 'Usa MP4, MOV, M4V o WebM.'); continue }
        if (file.size > CHAT_VIDEO_MAX_BYTES) { notify('Video demasiado grande', 'Para mantener el chat rápido y gratuito, cada video debe pesar 12 MB o menos.'); continue }
      } else if (isAudio) {
        mediaKind='audio'
        if (!isSupportedAudio(file)) { notify('Audio no compatible', 'Usa MP3, M4A, AAC, WAV, WebM u OGG.'); continue }
        if (file.size > CHAT_AUDIO_MAX_BYTES) { notify('Audio demasiado grande', 'Para mantener el chat rápido y gratuito, cada audio debe pesar 8 MB o menos.'); continue }
      } else {
        notify('Archivo no compatible', 'Selecciona una foto, un video o un audio.');
        continue
      }

      const job:PendingMedia = {
        kind:'media',
        mediaKind,
        id:crypto.randomUUID(),
        file,
        objectUrl:URL.createObjectURL(file),
        replyToId:features?.getReplyToId() || null,
        busy:false
      }
      renderPendingMedia(job)
      void outbox.add(job)
    }
  }

  const stopVoiceClock = () => {
    if (voiceTimer !== null) window.clearInterval(voiceTimer)
    voiceTimer = null
  }

  const setVoiceUi = (recording:boolean) => {
    composer.classList.toggle('is-recording', recording)
    voiceRecording.hidden = !recording
    if (!recording) voiceTime.textContent = '0:00'
    if (recording) {
      closeAttachMenu()
      input.blur()
      stickToLatest = true
      scheduleLatest()
    }
  }

  const startVoiceMessage = async () => {
    if (voiceBusy || voiceSession) return
    if (!canRecordVoice()) {
      notify('Micrófono no disponible', 'Este dispositivo o navegador no permite grabar mensajes de voz.')
      return
    }
    voiceBusy = true
    voiceButton.disabled = true
    try {
      const session = await beginVoiceRecording()
      if (closed) {
        await session.cancel()
        return
      }
      voiceSession = session
      setVoiceUi(true)
      voiceTime.textContent = '0:00'
      voiceTimer = window.setInterval(() => {
        if (voiceSession) voiceTime.textContent = mediaTime((Date.now() - voiceSession.startedAt) / 1000)
      }, 250)
    } catch (error:any) {
      console.error('Voice recording start failed', error)
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
      notify(denied ? 'Permiso de micrófono' : 'No se pudo grabar', denied ? 'Permite el acceso al micrófono para enviar mensajes de voz.' : 'No fue posible iniciar el micrófono en este dispositivo.')
    } finally {
      voiceBusy = false
      voiceButton.disabled = false
    }
  }

  const cancelVoiceMessage = async () => {
    if (voiceBusy) return
    const session = voiceSession
    voiceSession = null
    stopVoiceClock()
    setVoiceUi(false)
    if (session) await session.cancel()
  }

  const sendVoiceMessage = async () => {
    if (voiceBusy || !voiceSession) return
    voiceBusy = true
    voiceCancel.disabled = true
    voiceSend.disabled = true
    const session = voiceSession
    voiceSession = null
    stopVoiceClock()
    try {
      const recording = await session.stop()
      setVoiceUi(false)
      if (recording.durationMs < 450 || recording.file.size < 400) {
        notify('Mensaje de voz muy corto', 'Graba un poco más antes de enviarlo.')
        return
      }
      if (recording.file.size > CHAT_AUDIO_MAX_BYTES) {
        notify('Mensaje de voz demasiado largo', 'El mensaje de voz supera el límite de 8 MB.')
        return
      }
      const job:PendingMedia = {
        kind:'media',
        mediaKind:'audio',
        id:crypto.randomUUID(),
        file:recording.file,
        objectUrl:URL.createObjectURL(recording.file),
        replyToId:features?.getReplyToId() || null,
        busy:false
      }
      features?.clearReply()
      renderPendingMedia(job)
      void outbox.add(job)
    } catch (error) {
      console.error('Voice recording stop failed', error)
      setVoiceUi(false)
      notify('No se pudo enviar', 'El mensaje de voz no pudo prepararse. Inténtalo otra vez.')
    } finally {
      voiceBusy = false
      voiceCancel.disabled = false
      voiceSend.disabled = false
    }
  }

  const onPendingClick = (event:Event) => {
    const target = event.target as HTMLElement
    const mediaButton = target.closest<HTMLElement>('[data-retry-media]')
    if (mediaButton) {
      const pending = mediaButton.closest<HTMLElement>('[data-pending-id]')
      const id = pending?.dataset.pendingId
      if (id) outbox.retry(id)
      return
    }
    const textButton = target.closest<HTMLElement>('[data-retry-text]')
    if (textButton) {
      const pending = textButton.closest<HTMLElement>('[data-pending-text-id]')
      const id = pending?.dataset.pendingTextId
      if (id) outbox.retry(id)
    }
  }

  let synchronizing = false
  const synchronizeLatest = async () => {
    if (closed || synchronizing) return
    synchronizing = true
    try {
      const { data, error } = await supabase.rpc('get_chat_messages', { p_before:null, p_limit:MAX_LOADED_MESSAGES })
      if (error) throw error
      const canonical = orderMessages(((data || []) as RawChatRow[]).map(nameRow))
      await primeMedia(canonical.map(message => message.attachment_path))
      await fetchMissingReplies(canonical)
      for (const message of canonical) {
        const current = byId.get(message.id)
        if (!current) {
          await appendMessage(message, false)
          continue
        }
        if (
          current.body !== message.body ||
          current.edited_at !== message.edited_at ||
          current.deleted_at !== message.deleted_at ||
          current.attachment_path !== message.attachment_path ||
          current.attachment_type !== message.attachment_type
        ) {
          byId.set(message.id, message)
          const index = all.findIndex(item => item.id === message.id)
          if (index >= 0) all[index] = message
          replaceMessageElement(message.id)
        }
      }
      all = orderMessages(all)
    } catch (error) {
      console.error('Chat synchronization failed', error)
    } finally {
      synchronizing = false
    }
  }

  const onConnectivityReturn = () => { if (!closed) void synchronizeLatest() }
  const onVisibilityReturn = () => { if (document.visibilityState === 'visible') void synchronizeLatest() }

  const subscribeCore = () => {
    coreChannel = supabase.channel(`familia-noa-chat-core-${memberId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'messages' }, payload => {
        const row = payload.new as RawChatRow
        if (!row?.id || byId.has(row.id) || closed) return
        void (async()=>{
          if(row.attachment_path){try{await signMedia(row.attachment_path)}catch(error){console.error('Chat media authorization failed',error)}}
          await appendMessage(nameRow(row), false)
        })()
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
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void synchronizeLatest()
      })
  }

  back.addEventListener('click', backView)
  list.addEventListener('scroll', onScroll, { passive:true })
  composer.addEventListener('submit', onSubmit)
  attach.addEventListener('click', onAttachClick)
  attachMenu.addEventListener('click', onAttachMenuClick)
  fileInput.addEventListener('change', onAttachment)
  voiceButton.addEventListener('click', startVoiceMessage)
  voiceCancel.addEventListener('click', cancelVoiceMessage)
  voiceSend.addEventListener('click', sendVoiceMessage)
  list.addEventListener('click', onPendingClick)
  list.addEventListener('click', onImageClick)
  list.addEventListener('click', onVideoClick)
  list.addEventListener('click', onAudioClick)
  list.addEventListener('loadedmetadata', onAudioState, true)
  list.addEventListener('timeupdate', onAudioState, true)
  list.addEventListener('play', onAudioState, true)
  list.addEventListener('pause', onAudioState, true)
  list.addEventListener('ended', onAudioState, true)
  document.addEventListener('pointerdown', onDocumentPointer)
  window.addEventListener('online', onConnectivityReturn)
  document.addEventListener('visibilitychange', onVisibilityReturn)

  activeCleanup = () => {
    closed = true
    stopVoiceClock()
    if (voiceSession) {
      const session = voiceSession
      voiceSession = null
      void session.cancel()
    }
    window.removeEventListener('online', onConnectivityReturn)
    document.removeEventListener('visibilitychange', onVisibilityReturn)
    document.removeEventListener('pointerdown', onDocumentPointer)
    features?.cleanup()
    features = null
    void coreChannel?.unsubscribe()
    coreChannel = null
    back.removeEventListener('click', backView)
    list.removeEventListener('scroll', onScroll)
    composer.removeEventListener('submit', onSubmit)
    attach.removeEventListener('click', onAttachClick)
    attachMenu.removeEventListener('click', onAttachMenuClick)
    fileInput.removeEventListener('change', onAttachment)
    voiceButton.removeEventListener('click', startVoiceMessage)
    voiceCancel.removeEventListener('click', cancelVoiceMessage)
    voiceSend.removeEventListener('click', sendVoiceMessage)
    list.removeEventListener('click', onPendingClick)
    list.removeEventListener('click', onImageClick)
    list.removeEventListener('click', onVideoClick)
    list.removeEventListener('click', onAudioClick)
    list.removeEventListener('loadedmetadata', onAudioState, true)
    list.removeEventListener('timeupdate', onAudioState, true)
    list.removeEventListener('play', onAudioState, true)
    list.removeEventListener('pause', onAudioState, true)
    list.removeEventListener('ended', onAudioState, true)
    closeMediaViewer()
    outbox.clear(job => { if (job.kind === 'media') URL.revokeObjectURL(job.objectUrl) })
    unbindViewport()
  }

  await renderInitial()
  if (closed) return
  subscribeCore()
  await outbox.restore(job => {
    if (job.kind === 'media') {
      job.objectUrl = URL.createObjectURL(job.file)
      renderPendingMedia(job)
    } else {
      renderPendingText(job)
    }
  })
  if (stickToLatest) scheduleLatest()
}

import './styles.css'
import { supabase } from './supabase'
import { clearIdentity, getAuthenticatedFamilyMember, getIdentity, setIdentity } from './core/identity'
import { closeChat, openChat } from './chat-core'
import { startHomeChatUnread, stopHomeChatUnread } from './chat-features'
import { initNavigation, enterView, replaceView, type AppView } from './core/navigation'
import { closeMediaViewer, isMediaViewerOpen } from './core/media-viewer'

type Member = { id: string; name: string; active: boolean; must_share_location: boolean }
type FamilySessionResponse = {
  ok?: boolean
  profile?: { id:string; name:string }
  session?: { access_token:string; refresh_token:string }
  error?: string
}

const FALLBACK = ['Mamá', 'Papá', 'Romel', 'Osniel', 'Abner']
let members: Member[] = []
let membersLoaded = false
let settingsLoaded = false
let settingsCache: any = null
const initialIdentity = getIdentity()
let memberName = initialIdentity?.name || ''
let memberId = initialIdentity?.memberId || ''
let settingsChannel: ReturnType<typeof supabase.channel> | null = null
let familySyncChannel: ReturnType<typeof supabase.channel> | null = null
const app = document.querySelector<HTMLDivElement>('#app')!
document.title = 'FAMILIA NOA'

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))
const time = (value: string) => new Date(value).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })

async function loadMembers(force = false) {
  if (membersLoaded && !force) return
  const { data } = await supabase.from('family_members').select('id,name,active,must_share_location').eq('active', true).order('created_at')
  members = (data || []) as Member[]
  membersLoaded = true
  if (!members.length) members = FALLBACK.map((name, index) => ({ id:String(index), name, active:true, must_share_location:name === 'Mamá' || name === 'Papá' }))
}

function stopActiveViews() {
  closeChat()
  stopHomeChatUnread()
}

async function clearFamilySession() {
  try { await supabase.auth.signOut({ scope:'local' }) } catch {}
  clearIdentity()
  memberName = ''
  memberId = ''
}

async function acceptFamilySession(result: FamilySessionResponse) {
  const profile = result.profile
  const session = result.session
  if (!profile?.id || !profile.name || !session?.access_token || !session.refresh_token) throw new Error('INVALID_FAMILY_SESSION')
  const { error:sessionError } = await supabase.auth.setSession({ access_token:session.access_token, refresh_token:session.refresh_token })
  if (sessionError) throw sessionError
  const { data:{ user }, error:userError } = await supabase.auth.getUser()
  if (userError || !user || user.app_metadata?.family_member !== true || String(user.app_metadata?.member_id || '') !== profile.id) {
    await supabase.auth.signOut({ scope:'local' })
    throw userError || new Error('FAMILY_SESSION_MISMATCH')
  }
  setIdentity({ memberId:profile.id, name:profile.name })
  memberName = profile.name
  memberId = profile.id
}

function login(errorText = '') {
  stopActiveViews()
  app.innerHTML = `<main class="login"><div class="brand"><span>FAMILIA</span><strong>NOA</strong></div><p class="eyebrow">PRIVATE FAMILY SPACE</p><h1>¿Quién eres?</h1><p class="intro">Un solo lugar para estar cerca, estés donde estés.</p>${errorText ? `<div class="errorbox">${esc(errorText)}</div>` : ''}<div class="members">${members.map(member => `<button class="member" data-name="${esc(member.name)}">${esc(member.name)}<span>›</span></button>`).join('')}</div></main>`
  document.querySelectorAll<HTMLButtonElement>('[data-name]').forEach(button => button.onclick = () => securityStep(button.dataset.name!))
}

function securityStep(name: string) {
  stopActiveViews()
  const selected = members.find(member => member.name === name)
  if (!selected) return
  app.innerHTML = `<main class="login"><button class="backlink" id="back">‹ Volver</button><div class="brand"><span>FAMILIA</span><strong>NOA</strong></div><p class="eyebrow">ACCESO FAMILIAR</p><h1>${esc(name)}</h1><p class="intro">Confirma tus datos para entrar.</p><form class="security-form" id="security"><label>Número de la casa de Trinidad<input id="house" inputmode="numeric" autocomplete="off" required></label><label>Tu apodo en la familia<input id="nickname" autocomplete="off" required></label><button class="primary" type="submit">Entrar</button></form><div id="securityError"></div></main>`
  document.querySelector('#back')!.addEventListener('click', () => login())
  document.querySelector('#security')!.addEventListener('submit', async event => {
    event.preventDefault()
    const house = document.querySelector<HTMLInputElement>('#house')!.value.trim()
    const nickname = document.querySelector<HTMLInputElement>('#nickname')!.value.trim()
    const error = document.querySelector('#securityError')!
    const submit = document.querySelector<HTMLButtonElement>('#security button[type="submit"]')!
    error.textContent = 'Verificando…'
    submit.disabled = true
    try {
      const { data, error:functionError } = await supabase.functions.invoke('family-session', {
        body:{ member_id:selected.id, house_number:house, nickname }
      })
      const result = data as FamilySessionResponse | null
      if (functionError || !result?.ok) throw functionError || new Error(result?.error || 'LOGIN_FAILED')
      await acceptFamilySession(result)
      renderHome()
      startSettingsRealtime()
      startFamilyRealtime()
    } catch (loginError) {
      console.error('Family session login failed', loginError)
      error.textContent = 'Datos incorrectos. Comprueba el número de la casa y tu apodo.'
      submit.disabled = false
    }
  })
}

function applySettings(settings: any) {
  const root = document.documentElement
  if (settings?.background) root.style.setProperty('--bg', settings.background)
  if (settings?.surface) root.style.setProperty('--surface', settings.surface)
  if (settings?.ink) root.style.setProperty('--ink', settings.ink)
  if (settings?.accent) root.style.setProperty('--accent', settings.accent)
  if (settings?.font === 'sans') root.style.setProperty('--display-font', 'Inter, system-ui, sans-serif')
  else if (settings?.font === 'mono') root.style.setProperty('--display-font', 'ui-monospace, SFMono-Regular, Menlo, monospace')
  else root.style.setProperty('--display-font', 'Georgia, "Times New Roman", serif')
  const hero = document.querySelector('.hero h2')
  if (hero && settings?.heroTitle) hero.textContent = settings.heroTitle
  const heroText = document.querySelector('.hero p:not(.eyebrow)')
  if (heroText && settings?.heroText) heroText.textContent = settings.heroText
}

async function loadSettings(force = false) {
  if (settingsLoaded && !force) {
    if (settingsCache) applySettings(settingsCache)
    return
  }
  const { data } = await supabase.from('app_settings').select('settings').eq('id', 'global').maybeSingle()
  settingsCache = data?.settings || null
  settingsLoaded = true
  if (settingsCache) applySettings(settingsCache)
}

function startSettingsRealtime() {
  settingsChannel?.unsubscribe()
  settingsChannel = supabase.channel('familia-noa-settings')
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'app_settings', filter:'id=eq.global' }, payload => {
      settingsCache = (payload.new as any).settings || null
      settingsLoaded = true
      applySettings(settingsCache)
    })
    .subscribe()
}

function startFamilyRealtime() {
  familySyncChannel?.unsubscribe()
  familySyncChannel = supabase.channel('familia-noa-family-sync')
    .on('postgres_changes', { event:'*', schema:'public', table:'family_members' }, payload => {
      const row = payload.new as Partial<Member> & { id?:string }
      const old = payload.old as Partial<Member> & { id?:string }
      if (payload.eventType === 'DELETE') {
        members = members.filter(member => member.id !== old.id)
      } else if (row.id) {
        const next = { id:row.id, name:row.name || '', active:row.active !== false, must_share_location:!!row.must_share_location } as Member
        const index = members.findIndex(member => member.id === next.id)
        if (next.active) {
          if (index >= 0) members[index] = next
          else members.push(next)
        } else if (index >= 0) members.splice(index, 1)
      }
      membersLoaded = true
      const current = members.find(member => member.id === memberId)
      if (!current) {
        void clearFamilySession()
        login('Este perfil ya no está activo.')
      }
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'locations' }, () => {
      if (document.querySelector('.family-locations')) void loadLocations()
    })
    .subscribe()
}

function openChatScreen(push = true) {
  if (push) enterView('chat')
  stopHomeChatUnread()
  void openChat({
    app,
    memberId,
    memberName,
    members:members.map(member => ({ id:member.id, name:member.name })),
    notify:sheet
  })
}

function renderHome() {
  replaceView('home')
  closeChat()
  stopHomeChatUnread()
  app.innerHTML = `<main class="shell"><header class="top"><div><p class="eyebrow">FAMILIA NOA</p><h1>Hola, ${esc(memberName)} <span>♡</span></h1></div><button class="avatar" id="change">${esc(memberName.charAt(0))}</button></header><section class="hero"><p class="eyebrow">TODOS CERCA</p><h2>¿Cómo está la familia hoy?</h2><p>Habla, comparte y revisa que todos estén bien.</p></section><section class="grid"><button class="card dark" id="chat"><i>✦</i><b>Chat</b><small>Habla con todos</small></button><button class="card photo" id="photos"><i>◌</i><b>Fotos</b><small>Momentos de familia</small></button><button class="card" id="location"><i>⌖</i><b>Ubicación</b><small>Ver dónde estamos</small></button><button class="card ok" id="ok"><i>♥</i><b>Estoy bien</b><small>Avísale a la familia</small></button><button class="card help" id="help"><i>!</i><b>Ayuda</b><small>Necesito a mi familia</small></button></section><nav><button class="active">Inicio</button><button id="navchat">Chat</button><button id="navphotos">Fotos</button><button id="navlocation">Ubicación</button></nav></main>`
  if (settingsCache) applySettings(settingsCache)
  startHomeChatUnread(memberId)
  document.querySelector('#change')!.addEventListener('click', async () => {
    stopActiveViews()
    familySyncChannel?.unsubscribe()
    settingsChannel?.unsubscribe()
    await clearFamilySession()
    login()
  })
  document.querySelector('#chat')!.addEventListener('click', () => openChatScreen())
  document.querySelector('#navchat')!.addEventListener('click', () => openChatScreen())
  document.querySelector('#photos')!.addEventListener('click', () => void renderPhotos())
  document.querySelector('#navphotos')!.addEventListener('click', () => void renderPhotos())
  document.querySelector('#location')!.addEventListener('click', renderLocation)
  document.querySelector('#navlocation')!.addEventListener('click', renderLocation)
  document.querySelector('#ok')!.addEventListener('click', setWellbeing)
  document.querySelector('#help')!.addEventListener('click', sendHelp)
}

async function setWellbeing() {
  if (!memberId) return
  const { error } = await supabase.from('wellbeing_status').upsert({ member_id:memberId, is_ok:true, updated_at:new Date().toISOString() })
  sheet(error ? 'No se pudo actualizar' : 'Estoy bien ❤️', error ? 'El estado no pudo guardarse todavía.' : 'La familia puede ver que estás bien.')
}

async function sendHelp() {
  if (!memberId) return
  const { error } = await supabase.from('help_alerts').insert({ member_id:memberId, message:`${memberName} necesita ayuda.` })
  sheet(error ? 'No se pudo enviar' : 'Ayuda enviada', error ? 'Inténtalo de nuevo en un momento.' : 'La familia recibirá tu alerta.')
}

async function renderPhotos(push = true) {
  if (push) enterView('photos')
  stopHomeChatUnread()
  closeChat()
  app.innerHTML = '<main class="page photo-page" data-photo-page><div class="loading">Cargando álbumes…</div></main>'
}

async function renderLocation() {
  stopHomeChatUnread()
  closeChat()
  const current = members.find(member => member.id === memberId)
  const mandatory = !!current?.must_share_location
  app.innerHTML = `<main class="page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación</h1></div></header><section class="locationbox"><div class="pin">⌖</div><h2>Compartir ubicación</h2><p id="locationtext">${mandatory ? 'La ubicación es necesaria para este perfil.' : 'Comparte tu ubicación con la familia cuando quieras.'}</p><button class="primary" id="sharelocation">${mandatory ? 'Activar ubicación' : 'Actualizar ubicación'}</button></section><section class="family-locations" id="familylocations"><div class="loading">Cargando…</div></section></main>`
  document.querySelector('#back')!.addEventListener('click', renderHome)
  document.querySelector('#sharelocation')!.addEventListener('click', shareLocation)
  await loadLocations()
}

async function shareLocation() {
  const text = document.querySelector('#locationtext')!
  if (!navigator.geolocation) {
    text.textContent = 'Este dispositivo no permite ubicación.'
    return
  }
  text.textContent = 'Obteniendo ubicación…'
  navigator.geolocation.getCurrentPosition(async position => {
    if (memberId) await supabase.from('locations').upsert({ member_id:memberId, latitude:position.coords.latitude, longitude:position.coords.longitude, accuracy:position.coords.accuracy, updated_at:new Date().toISOString() })
    text.textContent = `Ubicación actualizada · precisión aproximada ${Math.round(position.coords.accuracy)} m.`
    await loadLocations()
  }, () => {
    text.textContent = 'Necesitamos permiso para acceder a tu ubicación.'
  }, { enableHighAccuracy:true, timeout:15000 })
}

async function loadLocations() {
  const element = document.querySelector('#familylocations')
  if (!element) return
  const { data } = await supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at,family_members(name)').order('updated_at', { ascending:false })
  element.innerHTML = (data || []).map((item:any) => `<div class="locationrow"><b>${esc(item.family_members?.name || 'Familia')}</b><small>Actualizado ${time(item.updated_at)} · ${Math.round(item.accuracy || 0)} m</small><a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${item.latitude},${item.longitude}">Ver mapa ›</a></div>`).join('') || '<div class="empty">Aún no hay ubicaciones compartidas.</div>'
}

function sheet(title: string, text: string) {
  const element = document.createElement('div')
  element.className = 'overlay'
  element.innerHTML = `<div class="sheet"><button class="close">×</button><p class="eyebrow">FAMILIA NOA</p><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`
  document.body.appendChild(element)
  element.querySelector('.close')!.addEventListener('click', () => element.remove())
  element.addEventListener('click', event => { if (event.target === element) element.remove() })
}

async function boot() {
  await loadMembers()
  const authenticated = await getAuthenticatedFamilyMember()
  if (authenticated && members.some(member => member.id === authenticated.id)) {
    const identity = getIdentity()
    if (!identity || identity.memberId !== authenticated.id || identity.name !== authenticated.name) {
      setIdentity({ memberId:authenticated.id, name:authenticated.name })
    }
    memberId = authenticated.id
    memberName = authenticated.name
    renderHome()
    startSettingsRealtime()
    startFamilyRealtime()
    return
  }
  await clearFamilySession()
  login()
}

void loadSettings()
void boot()

initNavigation((view:AppView) => {
  if (view === 'media') return
  if (isMediaViewerOpen()) closeMediaViewer()
  if (view === 'chat') { openChatScreen(false); return }
  if (view === 'photos' || view === 'album') { void renderPhotos(false); return }
  if (view === 'home') renderHome()
})

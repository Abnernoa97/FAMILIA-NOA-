import './styles.css'
import { supabase } from './supabase'
import { clearIdentity, getAuthenticatedFamilyMember, getIdentity, setIdentity } from './core/identity'
import { closeChat, openChat } from './chat-core'
import { startHomeChatUnread, stopHomeChatUnread } from './chat-features'
import { initNavigation, enterView, replaceView, backView, type AppView } from './core/navigation'
import { closeMediaViewer, isMediaViewerOpen } from './core/media-viewer'

type Member = { id: string; name: string; active: boolean; must_share_location: boolean }
type FamilySessionResponse = {
  ok?: boolean
  profile?: { id:string; name:string }
  session?: { access_token:string; refresh_token:string }
  error?: string
}
type FamilyLocation = {
  member_id:string
  latitude:number
  longitude:number
  accuracy:number|null
  updated_at:string
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
let mandatoryLocationVerified = false
let mandatoryLocationGateActive = false
const app = document.querySelector<HTMLDivElement>('#app')!
document.title = 'FAMILIA NOA'

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))

function locationAge(value:string){
  const ms=Date.now()-new Date(value).getTime()
  if(!Number.isFinite(ms)||ms<0)return 'actualizada ahora'
  const minutes=Math.floor(ms/60000)
  if(minutes<1)return 'actualizada ahora'
  if(minutes<60)return `hace ${minutes} min`
  const hours=Math.floor(minutes/60)
  if(hours<24)return `hace ${hours} h`
  const days=Math.floor(hours/24)
  if(days<7)return `hace ${days} día${days===1?'':'s'}`
  return new Date(value).toLocaleDateString('es-MX',{day:'numeric',month:'short'})
}

async function loadMembers(force = false) {
  if (membersLoaded && !force) return
  const { data } = await supabase.from('family_members').select('id,name,active,must_share_location').eq('active', true).order('created_at')
  members = (data || []) as Member[]
  membersLoaded = true
  if (!members.length) members = FALLBACK.map((name, index) => ({ id:String(index), name, active:true, must_share_location:name === 'Mamá' || name === 'Papá' }))
}

function currentMember(){
  return members.find(member=>member.id===memberId)||null
}

function requiresMandatoryLocation(){
  return !!currentMember()?.must_share_location&&!mandatoryLocationVerified
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
  mandatoryLocationVerified = false
  mandatoryLocationGateActive = false
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
  mandatoryLocationVerified = false
  mandatoryLocationGateActive = false
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
      startSettingsRealtime()
      startFamilyRealtime()
      enterFamilyHome()
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
        return
      }
      if(current.must_share_location&&!mandatoryLocationVerified)renderMandatoryLocation()
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'locations' }, () => {
      if (document.querySelector('.family-locations')) void loadLocations()
    })
    .subscribe()
}

function openChatScreen(push = true) {
  if (requiresMandatoryLocation()) { renderMandatoryLocation(); return }
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

function enterFamilyHome(){
  if(requiresMandatoryLocation()){
    renderMandatoryLocation()
    return
  }
  renderHome()
}

function renderHome() {
  if(requiresMandatoryLocation()){
    renderMandatoryLocation()
    return
  }
  replaceView('home')
  mandatoryLocationGateActive=false
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
  document.querySelector('#location')!.addEventListener('click', () => void renderLocation())
  document.querySelector('#navlocation')!.addEventListener('click', () => void renderLocation())
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
  if (requiresMandatoryLocation()) { renderMandatoryLocation(); return }
  if (push) enterView('photos')
  stopHomeChatUnread()
  closeChat()
  app.innerHTML = '<main class="page photo-page" data-photo-page><div class="loading">Cargando álbumes…</div></main>'
}

function renderMandatoryLocation(){
  mandatoryLocationGateActive=true
  replaceView('location')
  stopHomeChatUnread()
  closeChat()
  app.innerHTML=`<main class="page location-page"><header class="pagehead"><div style="width:42px"></div><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación requerida</h1></div></header><section class="locationbox"><div class="pin">⌖</div><div><p class="eyebrow">OBLIGATORIO</p><h2>Comparte tu ubicación para continuar</h2><p id="locationtext">Para ${esc(memberName)}, la ubicación debe estar activa y actualizarse al entrar a la app.</p></div><button class="primary" id="sharelocation">Activar ubicación y continuar</button></section><section class="family-locations" id="familylocations"><div class="location-section-title"><b>Familia</b><span>Se actualiza en tiempo real</span></div><div class="loading">Cargando…</div></section></main>`
  document.querySelector('#sharelocation')!.addEventListener('click',()=>void shareLocation())
  void loadLocations()
}

async function renderLocation(push = true) {
  if (requiresMandatoryLocation()) { renderMandatoryLocation(); return }
  mandatoryLocationGateActive=false
  if (push) enterView('location')
  stopHomeChatUnread()
  closeChat()
  const current = currentMember()
  const mandatory = !!current?.must_share_location
  app.innerHTML = `<main class="page location-page"><header class="pagehead"><button id="back" aria-label="Volver">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación</h1></div></header><section class="locationbox"><div class="pin">⌖</div><div><p class="eyebrow">TU UBICACIÓN</p><h2>${mandatory?'Mantener ubicación al día':'Compartir ubicación'}</h2><p id="locationtext">${mandatory?'La ubicación es obligatoria para este perfil y se verifica cada vez que entras a la app.':'Comparte tu ubicación con la familia cuando quieras.'}</p></div><button class="primary" id="sharelocation">Actualizar ubicación</button></section><section class="family-locations" id="familylocations"><div class="location-section-title"><b>Familia</b><span>Se actualiza en tiempo real</span></div><div class="loading">Cargando…</div></section></main>`
  document.querySelector('#back')!.addEventListener('click', () => backView())
  document.querySelector('#sharelocation')!.addEventListener('click', () => void shareLocation())
  await loadLocations()
}

function geolocationErrorText(error:unknown){
  const code=Number((error as GeolocationPositionError | undefined)?.code||0)
  if(code===1)return 'El permiso de ubicación está desactivado. Actívalo en los permisos de la app o del navegador.'
  if(code===2)return 'No pudimos obtener tu ubicación en este momento. Comprueba GPS y conexión.'
  if(code===3)return 'La ubicación tardó demasiado en responder. Inténtalo de nuevo.'
  return 'No se pudo actualizar tu ubicación. Inténtalo de nuevo.'
}

function currentPosition(){
  return new Promise<GeolocationPosition>((resolve,reject)=>{
    navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:20000,maximumAge:15000})
  })
}

async function shareLocation() {
  const text = document.querySelector<HTMLElement>('#locationtext')
  const button = document.querySelector<HTMLButtonElement>('#sharelocation')
  if (!text || !button) return
  if (!navigator.geolocation) {
    text.textContent = 'Este dispositivo no permite ubicación.'
    return
  }
  if(!memberId){
    text.textContent='No se pudo identificar tu perfil.'
    return
  }

  button.disabled=true
  button.textContent='Obteniendo ubicación…'
  text.textContent='Buscando tu posición actual…'
  try{
    const position=await currentPosition()
    const latitude=position.coords.latitude
    const longitude=position.coords.longitude
    const accuracy=position.coords.accuracy
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180){
      throw new Error('INVALID_LOCATION')
    }
    button.textContent='Guardando…'
    const {error}=await supabase.from('locations').upsert({
      member_id:memberId,
      latitude,
      longitude,
      accuracy:Number.isFinite(accuracy)?accuracy:null,
      updated_at:new Date().toISOString()
    },{onConflict:'member_id'})
    if(error)throw error
    text.textContent=`Ubicación actualizada ahora${Number.isFinite(accuracy)?` · precisión aproximada ${Math.round(accuracy)} m`:''}.`
    mandatoryLocationVerified=true
    await loadLocations()
    if(mandatoryLocationGateActive){
      mandatoryLocationGateActive=false
      renderHome()
      return
    }
  }catch(error){
    console.error('Family location update failed',error)
    text.textContent=geolocationErrorText(error)
  }finally{
    if(document.contains(button)){
      button.disabled=false
      button.textContent=mandatoryLocationGateActive?'Activar ubicación y continuar':'Actualizar ubicación'
    }
  }
}

async function loadLocations() {
  const element = document.querySelector<HTMLElement>('#familylocations')
  if (!element) return
  const { data,error } = await supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at').order('updated_at', { ascending:false })
  if(error){
    console.error('Family locations load failed',error)
    element.innerHTML='<div class="location-section-title"><b>Familia</b><span>Se actualiza en tiempo real</span></div><div class="empty">No se pudieron cargar las ubicaciones. Inténtalo de nuevo.</div>'
    return
  }

  const rows=(data||[]) as FamilyLocation[]
  const byMember=new Map(rows.map(row=>[row.member_id,row]))
  const ordered=[...members].sort((a,b)=>a.id===memberId?-1:b.id===memberId?1:0)
  const cards=ordered.map(member=>{
    const item=byMember.get(member.id)
    const mine=member.id===memberId
    if(!item){
      return `<div class="locationrow locationrow-empty"><div class="location-person"><span class="location-dot"></span><div><b>${esc(member.name)}${mine?' · tú':''}</b><small>${member.must_share_location?'Ubicación obligatoria pendiente':'Aún no ha compartido ubicación'}</small></div></div></div>`
    }
    const ageMs=Date.now()-new Date(item.updated_at).getTime()
    const stale=Number.isFinite(ageMs)&&ageMs>24*60*60*1000
    const accuracy=Number.isFinite(item.accuracy)?` · ±${Math.round(item.accuracy as number)} m`:''
    const href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${item.latitude},${item.longitude}`)}`
    return `<div class="locationrow${stale?' stale':''}"><div class="location-person"><span class="location-dot"></span><div><b>${esc(member.name)}${mine?' · tú':''}</b><small>${locationAge(item.updated_at)}${accuracy}</small></div></div><a target="_blank" rel="noopener noreferrer" href="${href}">Ver mapa ›</a></div>`
  }).join('')

  element.innerHTML=`<div class="location-section-title"><b>Familia</b><span>Se actualiza en tiempo real</span></div>${cards||'<div class="empty">Aún no hay ubicaciones compartidas.</div>'}`
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
    mandatoryLocationVerified=false
    startSettingsRealtime()
    startFamilyRealtime()
    enterFamilyHome()
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
  if(requiresMandatoryLocation()){
    renderMandatoryLocation()
    return
  }
  if (view === 'chat') { openChatScreen(false); return }
  if (view === 'photos' || view === 'album') { void renderPhotos(false); return }
  if (view === 'location') { void renderLocation(false); return }
  if (view === 'home') renderHome()
})
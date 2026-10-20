import './styles.css'
import './family-activity-notifications'
import { supabase } from './supabase'
import { clearIdentity, getAuthenticatedFamilyMember, getIdentity, setIdentity } from './core/identity'
import { closeChat, openChat } from './chat-core'
import { startHomeChatUnread, stopHomeChatUnread } from './chat-features'
import { initNavigation, enterView, replaceView, backView, type AppView } from './core/navigation'
import { closeMediaViewer, isMediaViewerOpen } from './core/media-viewer'
import { clearPrivateMediaCache } from './core/private-media'
import { getLocationState, refreshLocationState, saveOwnLocation, subscribeLocationState, isLiveFamilyLocation, type LocationState } from './core/location-store'
import { activateNativeLocationSharing, ensureOwnLocationRealtime, hasNativeLocationCapability, isDeviceLocationEnabled, isNativeLocationSharingEnabled, openDeviceLocationSettings, refreshMemberLocation, startOwnLocationRealtime } from './core/location-device-sync'

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
type HomeBootstrap = {
  memberId:string
  memberName:string
  members:Member[]
  settings:any
  savedAt:number
}

const FALLBACK = ['Mamá', 'Papá', 'Romel', 'Osniel', 'Abner']
const HOME_BOOTSTRAP_KEY='familia-noa-home-bootstrap-v1'

function readHomeBootstrap():HomeBootstrap|null{
  try{
    const raw=localStorage.getItem(HOME_BOOTSTRAP_KEY)
    if(!raw)return null
    const parsed=JSON.parse(raw) as HomeBootstrap
    if(!parsed?.memberId||!parsed?.memberName||!Array.isArray(parsed.members))return null
    return parsed
  }catch{return null}
}

const cachedBootstrap=readHomeBootstrap()
let members: Member[] = cachedBootstrap?.members?.length ? cachedBootstrap.members : []
let membersLoaded = members.length>0
let settingsLoaded = cachedBootstrap ? true : false
let settingsCache: any = cachedBootstrap?.settings ?? null
const initialIdentity = getIdentity()
let memberName = initialIdentity?.name || cachedBootstrap?.memberName || ''
let memberId = initialIdentity?.memberId || cachedBootstrap?.memberId || ''
let settingsChannel: ReturnType<typeof supabase.channel> | null = null
let familySyncChannel: ReturnType<typeof supabase.channel> | null = null
let mandatoryLocationVerified = false
let mandatoryLocationGateActive = false
let locationViewUnsubscribe:(()=>void)|null=null
let pendingNativeFix:{memberId:string;previousUpdatedAt:string;startedAt:number}|null=null
let nativeFixTimeout:number|null=null
let awaitingAndroidLocationSettings=false

function clearPendingNativeFix(){
  if(nativeFixTimeout!==null)window.clearTimeout(nativeFixTimeout)
  nativeFixTimeout=null
  pendingNativeFix=null
}

function waitForNativeFix(memberId:string,previousUpdatedAt:string,startedAt:number){
  clearPendingNativeFix()
  pendingNativeFix={memberId,previousUpdatedAt,startedAt}
  nativeFixTimeout=window.setTimeout(()=>{
    if(pendingNativeFix?.memberId!==memberId||pendingNativeFix.startedAt!==startedAt)return
    clearPendingNativeFix()
    const label=document.querySelector<HTMLElement>('#locationtext')
    const button=document.querySelector<HTMLButtonElement>('#sharelocation')
    if(label)label.textContent='No llegó una posición nueva en 45 segundos. Comprueba que la ubicación del teléfono siga encendida y vuelve a intentarlo.'
    if(button){button.disabled=false;button.textContent='Reintentar ubicación'}
  },45_000)
}

function resumeAndroidLocationSettings(){
  if(!awaitingAndroidLocationSettings||document.hidden)return
  awaitingAndroidLocationSettings=false
  window.setTimeout(()=>{
    const label=document.querySelector<HTMLElement>('#locationtext')
    const button=document.querySelector<HTMLButtonElement>('#sharelocation')
    if(!label||!button)return
    if(hasNativeLocationCapability()&&!isDeviceLocationEnabled()){
      label.textContent='La ubicación general del teléfono sigue apagada. Actívala en los ajustes de Android.'
      button.disabled=false
      button.textContent='Abrir ajustes de ubicación'
      return
    }
    void shareLocation()
  },400)
}
window.addEventListener('familia-noa:android-resumed',resumeAndroidLocationSettings)
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)resumeAndroidLocationSettings()
})
const app = document.querySelector<HTMLDivElement>('#app')!
document.title = 'FAMILIA NOA'

const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] || char))

function saveHomeBootstrap(){
  if(!memberId||!memberName||!members.length)return
  try{
    localStorage.setItem(HOME_BOOTSTRAP_KEY,JSON.stringify({
      memberId,
      memberName,
      members,
      settings:settingsCache,
      savedAt:Date.now()
    } satisfies HomeBootstrap))
  }catch{}
}

function clearHomeBootstrap(){
  try{localStorage.removeItem(HOME_BOOTSTRAP_KEY)}catch{}
}

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
  const loaded=(data || []) as Member[]
  if(loaded.length)members=loaded
  else if(!members.length)members = FALLBACK.map((name, index) => ({ id:String(index), name, active:true, must_share_location:name === 'Mamá' || name === 'Papá' }))
  membersLoaded = true
  saveHomeBootstrap()
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
  locationViewUnsubscribe?.()
  locationViewUnsubscribe=null
}

async function clearFamilySession() {
  try { await supabase.auth.signOut({ scope:'local' }) } catch {}
  clearIdentity()
  clearHomeBootstrap()
  clearPrivateMediaCache()
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
  saveHomeBootstrap()
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
      saveHomeBootstrap()
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
  settingsCache = data?.settings || settingsCache || null
  settingsLoaded = true
  if (settingsCache) applySettings(settingsCache)
  saveHomeBootstrap()
}

function startSettingsRealtime() {
  settingsChannel?.unsubscribe()
  settingsChannel = supabase.channel('familia-noa-settings')
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'app_settings', filter:'id=eq.global' }, payload => {
      settingsCache = (payload.new as any).settings || null
      settingsLoaded = true
      applySettings(settingsCache)
      saveHomeBootstrap()
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
      saveHomeBootstrap()
      const current = members.find(member => member.id === memberId)
      if (!current) {
        void clearFamilySession()
        login('Este perfil ya no está activo.')
        return
      }
      if(current.must_share_location&&!mandatoryLocationVerified)renderMandatoryLocation()
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

async function openProfileFromHome(button:HTMLButtonElement){
  try{
    await import('./profile-enhancer')
    button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}))
  }catch(error){
    console.error('Profile screen failed to load',error)
    sheet('Perfil no disponible','No se pudo abrir tu perfil en este momento. Inténtalo de nuevo.')
  }
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
  app.innerHTML = `<main class="shell"><header class="top"><div><p class="eyebrow">FAMILIA NOA</p><h1>Hola, ${esc(memberName)} <span>♡</span></h1></div><button class="avatar" id="change" aria-label="Abrir perfil">${esc(memberName.charAt(0))}</button></header><section class="hero"><p class="eyebrow">TODOS CERCA</p><h2>¿Cómo está la familia hoy?</h2><p>Habla, comparte y revisa que todos estén bien.</p></section><section class="grid"><button class="card dark" id="chat"><i>✦</i><b>Chat</b><small>Habla con todos</small></button><button class="card photo" id="photos"><i>◌</i><b>Fotos</b><small>Momentos de familia</small></button><button class="card" id="location"><i>⌖</i><b>Ubicación</b><small>Ver dónde estamos</small></button><button class="card ok" id="ok"><i>♥</i><b>Estoy bien</b><small>Avísale a la familia</small></button><button class="card help" id="help"><i>!</i><b>Ayuda</b><small>Necesito a mi familia</small></button></section><nav><button class="active">Inicio</button><button id="navchat">Chat</button><button id="navphotos">Fotos</button><button id="navlocation">Ubicación</button></nav></main>`
  if (settingsCache) applySettings(settingsCache)
  startHomeChatUnread(memberId)
  const profileButton=document.querySelector<HTMLButtonElement>('#change')!
  profileButton.addEventListener('click',event=>{
    event.preventDefault()
    void openProfileFromHome(profileButton)
  },{once:true})
  document.querySelector('#chat')!.addEventListener('click', () => openChatScreen())
  document.querySelector('#navchat')!.addEventListener('click', () => openChatScreen())
  document.querySelector('#photos')!.addEventListener('click', () => void renderPhotos())
  document.querySelector('#navphotos')!.addEventListener('click', () => void renderPhotos())
  document.querySelector('#location')!.addEventListener('click', () => void renderLocation())
  document.querySelector('#navlocation')!.addEventListener('click', () => void renderLocation())
  document.querySelector('#ok')!.addEventListener('click', setWellbeing)
  document.querySelector('#help')!.addEventListener('click', () => void sendHelp())
}

async function setWellbeing() {
  if (!memberId) return
  const { error } = await supabase.from('wellbeing_status').upsert({ member_id:memberId, is_ok:true, updated_at:new Date().toISOString() })
  sheet(error ? 'No se pudo actualizar' : 'Estoy bien ❤️', error ? 'El estado no pudo guardarse todavía.' : 'La familia puede ver que estás bien.')
}

async function sendHelp() {
  if (!memberId) return
  try{
    const {data,error}=await supabase.functions.invoke('family-emergency',{body:{action:'trigger'}})
    if(error||!data?.ok)throw error||new Error(data?.error||'EMERGENCY_FAILED')
    sheet('Emergencia activada','La alerta se envió a FAMILIA NOA y se intentará avisar por Push a los dispositivos registrados.')
  }catch(error){
    console.error('Family emergency trigger failed from home',error)
    const {error:fallbackError}=await supabase.from('help_alerts').insert({
      member_id:memberId,
      message:`${memberName} activó AYUDA.`,
      emergency:true
    })
    sheet(
      fallbackError?'No se pudo enviar':'Emergencia activada',
      fallbackError?'Comprueba tu conexión e inténtalo de nuevo.':'La familia la verá dentro de la app. El Push externo podría no haberse enviado.'
    )
  }
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
  locationViewUnsubscribe?.()
  locationViewUnsubscribe=null
  app.innerHTML=`<main class="page location-page"><header class="pagehead"><div style="width:42px"></div><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación requerida</h1></div></header><section class="locationbox"><div class="pin">⌖</div><div><p class="eyebrow">OBLIGATORIO</p><h2>Comparte tu ubicación para continuar</h2><p id="locationtext">Para ${esc(memberName)}, la ubicación debe estar activa y actualizarse al entrar a la app.</p></div><button class="primary" id="sharelocation">Activar ubicación y continuar</button></section><section class="family-locations" id="familylocations"><div class="location-section-title"><b>Familia</b><span>Se actualiza cuando alguien comparte</span></div><div class="loading">Cargando…</div></section></main>`
  document.querySelector('#sharelocation')!.addEventListener('click',()=>void shareLocation())
  locationViewUnsubscribe=subscribeLocationState(state=>renderLocationList(state))
  void loadLocations(true)
}

async function renderLocation(push = true) {
  if (requiresMandatoryLocation()) { renderMandatoryLocation(); return }
  mandatoryLocationGateActive=false
  if (push) enterView('location')
  stopHomeChatUnread()
  closeChat()
  locationViewUnsubscribe?.()
  locationViewUnsubscribe=null
  const current = currentMember()
  const mandatory = !!current?.must_share_location
  app.innerHTML = `<main class="page location-page"><header class="pagehead"><button id="back" aria-label="Volver">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación</h1></div></header><section class="locationbox"><div class="pin">⌖</div><div><p class="eyebrow">TU UBICACIÓN</p><h2>${mandatory?'Mantener ubicación al día':'Compartir ubicación'}</h2><p id="locationtext">${mandatory?'La ubicación es obligatoria para este perfil y se verifica cada vez que entras a la app.':'Comparte tu ubicación con la familia cuando quieras.'}</p></div><button class="primary" id="sharelocation">Activar ubicación</button></section><section class="family-locations" id="familylocations"><div class="location-section-title"><b>Familia</b><span>Se actualiza cuando alguien comparte</span></div><div class="loading">Cargando…</div></section></main>`
  document.querySelector('#back')!.addEventListener('click', () => backView())
  document.querySelector('#sharelocation')!.addEventListener('click', () => void shareLocation())
  locationViewUnsubscribe=subscribeLocationState(state=>renderLocationList(state))
  await loadLocations(true)
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

function confirmNativeLocationFix(state:LocationState){
  const pending=pendingNativeFix
  if(!pending||!isNativeLocationSharingEnabled())return false
  const location=state.locations.find(row=>row.member_id===pending.memberId)
  if(!location||location.updated_at===pending.previousUpdatedAt)return false
  const updatedAt=Date.parse(location.updated_at)
  if(!Number.isFinite(updatedAt)||updatedAt<pending.startedAt-5000)return false

  clearPendingNativeFix()
  mandatoryLocationVerified=true
  const text=document.querySelector<HTMLElement>('#locationtext')
  if(text){
    const accuracy=location.accuracy
    text.textContent=`Ubicación actualizada ahora${Number.isFinite(accuracy)?` · precisión aproximada ${Math.round(accuracy as number)} m`:''}.`
  }
  const button=document.querySelector<HTMLButtonElement>('#sharelocation')
  if(button){button.disabled=false;button.textContent='Ubicación verificada ✓'}
  if(mandatoryLocationGateActive){
    mandatoryLocationGateActive=false
    renderHome()
    return true
  }
  return false
}

async function shareLocation() {
  const text=document.querySelector<HTMLElement>('#locationtext')
  const button=document.querySelector<HTMLButtonElement>('#sharelocation')
  if(!text||!button)return
  if(!memberId){
    text.textContent='No se pudo identificar tu perfil.'
    return
  }

  clearPendingNativeFix()
  button.disabled=true
  button.textContent='Activando ubicación…'
  text.textContent='Preparando ubicación del teléfono…'
  try{
    if(hasNativeLocationCapability()){
      // System-wide device location requires Android user consent; never claim
      // that starting the foreground service turned on the phone's GPS switch.
      if(!isDeviceLocationEnabled()){
        text.textContent='La ubicación general del teléfono está apagada. Actívala en Android para compartir tu posición.'
        button.textContent='Abriendo ajustes de ubicación…'
        awaitingAndroidLocationSettings=openDeviceLocationSettings()
        if(!awaitingAndroidLocationSettings){
          text.textContent='No se pudieron abrir los ajustes de ubicación. Actívala desde Ajustes de Android.'
        }
        return
      }
      const previousUpdatedAt=getLocationState().locations.find(row=>row.member_id===memberId)?.updated_at||''
      const startedAt=Date.now()
      button.textContent='Activando GPS de Android…'
      if(await activateNativeLocationSharing(memberId)){
        waitForNativeFix(memberId,previousUpdatedAt,startedAt)
        text.textContent='Seguimiento Android iniciado. Esperando una posición nueva confirmada por el servidor…'
        button.textContent='Esperando señal GPS…'
        const state=await refreshLocationState({force:true})
        confirmNativeLocationFix(state)
        // Realtime confirms the first newly stored fix, even after this
        // button is re-enabled. Starting a service is not a GPS success.
        return
      }
      text.textContent='No se pudo iniciar el seguimiento Android. Intentando obtener una posición desde la app…'
    }

    if(!navigator.geolocation){
      text.textContent='No hay ubicación disponible en este dispositivo.'
      return
    }

    button.textContent='Obteniendo ubicación…'
    text.textContent='Buscando tu posición actual…'
    const position=await currentPosition()
    const latitude=position.coords.latitude
    const longitude=position.coords.longitude
    const accuracy=position.coords.accuracy
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180){
      throw new Error('INVALID_LOCATION')
    }
    button.textContent='Guardando…'
    await saveOwnLocation({
      memberId,
      latitude,
      longitude,
      accuracy:Number.isFinite(accuracy)?accuracy:null,
    })
    startOwnLocationRealtime(memberId)
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
      if(pendingNativeFix?.memberId===memberId){
        button.disabled=true
        button.textContent='Esperando señal GPS…'
      }else{
        button.disabled=false
        button.textContent=text.textContent?.startsWith('Ubicación actualizada ahora')
          ?'Ubicación verificada ✓'
          :awaitingAndroidLocationSettings||(hasNativeLocationCapability()&&!isDeviceLocationEnabled())
            ?'Abrir ajustes de ubicación'
            :mandatoryLocationGateActive?'Activar ubicación y continuar':'Activar ubicación'
      }
    }
  }
}

function renderLocationList(state:LocationState){
  if(confirmNativeLocationFix(state))return
  const element=document.querySelector<HTMLElement>('#familylocations')
  if(!element)return
  if(!state.updatedAt&&!state.error){
    element.innerHTML='<div class="location-section-title"><div><b>Familia</b><span>Ubicaciones pendientes o anteriores</span></div><small>Cargando…</small></div><div class="loading">Cargando ubicaciones…</div>'
    return
  }
  if(state.error&&!state.updatedAt){
    element.innerHTML='<div class="location-section-title"><div><b>Familia</b><span>Ubicaciones pendientes o anteriores</span></div><small>Sin conexión</small></div><div class="empty">No se pudieron cargar las ubicaciones. Inténtalo de nuevo.</div>'
    return
  }

  const rows=state.locations
  const byMember=new Map(rows.map(row=>[row.member_id,row]))
  const sourceMembers=state.members.length?state.members:members
  const now=Date.now()
  const ownGpsOff=hasNativeLocationCapability()&&!isDeviceLocationEnabled()
  const liveMemberIds=new Set(rows
    .filter(row=>isLiveFamilyLocation(row.updated_at,now)&&!(row.member_id===memberId&&ownGpsOff))
    .map(row=>row.member_id))
  // A member with a recent position is represented by their clickable marker
  // on the map. Below it, only show people who do NOT have a live position.
  const ordered=[...sourceMembers].filter(member=>!liveMemberIds.has(member.id)).sort((a,b)=>{
    const aHas=byMember.has(a.id)?0:1
    const bHas=byMember.has(b.id)?0:1
    if(aHas!==bHas)return aHas-bHas
    if(a.id===memberId)return -1
    if(b.id===memberId)return 1
    return a.name.localeCompare(b.name,'es')
  })
  if(byMember.has(memberId))ensureOwnLocationRealtime()
  const liveCount=liveMemberIds.size
  const summary=`${liveCount} en mapa · ${ordered.length} pendientes`
  const cards=ordered.map(member=>{
    const item=byMember.get(member.id)
    const mine=member.id===memberId
    const initial=esc(member.name.charAt(0).toUpperCase()||'•')
    if(!item){
      return `<article class="locationrow locationrow-empty" data-location-member="${esc(member.id)}"><div class="location-person"><span class="location-avatar-fallback">${initial}</span><div><b>${esc(member.name)}${mine?' · tú':''}</b><small>${member.must_share_location?'Ubicación obligatoria pendiente':'Sin ubicación compartida'}</small></div></div><span class="location-state-pill muted">Sin ubicación</span></article>`
    }
    const ageMs=now-Date.parse(item.updated_at)
    const stale=Number.isFinite(ageMs)&&ageMs>60*60*1000
    const accuracy=Number.isFinite(item.accuracy)?` · ±${Math.round(item.accuracy as number)} m`:''
    const deviceOff=mine&&ownGpsOff
    const status=deviceOff?'GPS apagado':'Última'
    // Old positions stay available on demand: tapping the row temporarily
    // focuses that historical location and labels its real age on the map.
    return `<article class="locationrow locationrow-active${stale?' stale':''}" data-location-member="${esc(member.id)}"><button type="button" class="location-focus" data-focus-location="${esc(member.id)}" aria-label="Ver última ubicación de ${esc(member.name)} en el mapa"><span class="location-avatar-fallback">${initial}</span><span class="location-person"><span><b>${esc(member.name)}${mine?' · tú':''}</b><small>Última ubicación · ${locationAge(item.updated_at)}${accuracy}</small></span></span><span class="location-state-pill">${status}</span><span class="location-chevron">›</span></button></article>`
  }).join('')
  // Keep relatives without a recent GPS fix visible in the original family
  // list. As a person starts sharing, their row moves to the live map; as
  // tracking goes stale, it returns here automatically, without a drawer.
  element.innerHTML=`<div class="location-section-title"><div><b>Familia</b><span>Sin ubicación en tiempo real</span></div><small>${summary}</small></div>${cards||'<div class="empty">Todos los familiares aparecen en el mapa.</div>'}`
  element.querySelectorAll<HTMLButtonElement>('[data-focus-location]').forEach(button=>{
    button.addEventListener('click',()=>{
      const targetId=button.dataset.focusLocation||''
      window.dispatchEvent(new CustomEvent('familia-noa:focus-location',{detail:{memberId:targetId}}))
      document.querySelector<HTMLElement>('[data-family-map]')?.scrollIntoView({behavior:'smooth',block:'center'})
      void refreshMemberLocation(targetId)
    })
  })
}

// Reclassify positions automatically as they age, even if Realtime is silent.
window.setInterval(()=>{
  if(!document.hidden&&document.querySelector('.location-page'))renderLocationList(getLocationState())
},30_000)
window.addEventListener('familia-noa:android-resumed',()=>{
  if(document.querySelector('.location-page'))renderLocationList(getLocationState())
})

async function loadLocations(force=false){
  const state=await refreshLocationState({force})
  renderLocationList(state)
}

function sheet(title: string, text: string) {
  const element = document.createElement('div')
  element.className = 'overlay'
  element.innerHTML = `<div class="sheet"><button class="close">×</button><p class="eyebrow">FAMILIA NOA</p><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`
  document.body.appendChild(element)
  element.querySelector('.close')!.addEventListener('click', () => element.remove())
  element.addEventListener('click', event => { if (event.target === element) element.remove() })
}

async function refreshFastBoot(expectedMemberId:string){
  try{
    const [authenticated]=await Promise.all([
      getAuthenticatedFamilyMember(),
      loadMembers(true),
      loadSettings(true)
    ])
    if(!authenticated||authenticated.id!==expectedMemberId){
      // Do not tear down a usable cached screen for a transient network failure.
      // Supabase will reject protected reads/actions and the next authenticated event
      // will reconcile the session. A verified active profile refreshes the cache below.
      return
    }
    memberId=authenticated.id
    memberName=authenticated.name
    const identity=getIdentity()
    if(!identity||identity.memberId!==authenticated.id||identity.name!==authenticated.name){
      setIdentity({memberId:authenticated.id,name:authenticated.name})
    }
    saveHomeBootstrap()
    if(requiresMandatoryLocation()){
      renderMandatoryLocation()
      return
    }
    const title=document.querySelector<HTMLElement>('.top h1')
    if(title)title.innerHTML=`Hola, ${esc(memberName)} <span>♡</span>`
    if(settingsCache)applySettings(settingsCache)
  }catch(error){
    console.warn('Background home refresh failed',error)
  }
}

async function boot() {
  const {data:{session}}=await supabase.auth.getSession()
  const sessionMemberId=String(session?.user?.app_metadata?.member_id||'')
  const familySession=!!session&&session.user?.app_metadata?.family_member===true&&!!sessionMemberId
  const cached=readHomeBootstrap()

  if(familySession&&cached&&cached.memberId===sessionMemberId&&cached.members.length){
    members=cached.members
    membersLoaded=true
    settingsCache=cached.settings??null
    settingsLoaded=true
    memberId=cached.memberId
    memberName=cached.memberName
    const identity=getIdentity()
    if(!identity||identity.memberId!==memberId||identity.name!==memberName){
      setIdentity({memberId,name:memberName})
    }
    mandatoryLocationVerified=false
    startSettingsRealtime()
    startFamilyRealtime()
    enterFamilyHome()
    void refreshFastBoot(sessionMemberId)
    return
  }

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
    saveHomeBootstrap()
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

type FamilyNotificationKind='online'|'location_sharing'|'presume_post'|'story'|'chat_message'
type NotificationTarget={kind:FamilyNotificationKind;memberId:string;referenceId?:string|null}

async function navigateFamilyNotification(detail:NotificationTarget){
  if(!getIdentity()?.memberId)return
  if(detail.kind==='chat_message'){openChatScreen();return}
  if(detail.kind==='presume_post'){
    await import('./presume-enhancer')
    document.dispatchEvent(new CustomEvent('presume:open-notification',{detail:{postId:detail.referenceId}}))
    return
  }
  if(detail.kind==='story'){
    renderHome()
    await import('./home-stories')
    window.dispatchEvent(new CustomEvent('familia-noa:open-story-notification',{detail:{memberId:detail.memberId}}))
    return
  }
  await renderLocation(true)
  if(detail.memberId)window.dispatchEvent(new CustomEvent('familia-noa:focus-location',{detail:{memberId:detail.memberId}}))
}

window.addEventListener('familia-noa:open-notification',event=>{
  const detail=(event as CustomEvent<NotificationTarget>).detail
  if(!detail||!['online','location_sharing','presume_post','story','chat_message'].includes(detail.kind))return
  void navigateFamilyNotification(detail).catch(error=>console.error('Notification navigation unavailable',error))
})

// The existing Android WebView forwards a tapped notification here after the
// home session has been restored. Store it until family identity is available.
const NATIVE_NOTICE_KEY='familia-noa-pending-native-notice'
window.addEventListener('familia-noa:native-notification',event=>{
  const detail=(event as CustomEvent<NotificationTarget>).detail
  if(!detail)return
  try{sessionStorage.setItem(NATIVE_NOTICE_KEY,JSON.stringify(detail))}catch{}
  void openPendingNativeNotice()
})
async function openPendingNativeNotice(){
  if(!getIdentity()?.memberId)return
  const raw=sessionStorage.getItem(NATIVE_NOTICE_KEY)
  if(!raw)return
  try{
    const detail=JSON.parse(raw) as NotificationTarget
    if(!['online','location_sharing','presume_post','story','chat_message'].includes(detail.kind))return
    sessionStorage.removeItem(NATIVE_NOTICE_KEY)
    await navigateFamilyNotification(detail)
  }catch(error){console.error('Native notification destination unavailable',error)}
}
window.addEventListener('familia-noa:identity-changed',()=>void openPendingNativeNotice())
window.setTimeout(()=>void openPendingNativeNotice(),1200)

window.addEventListener('familia-noa:open-location',event=>{
  if(!getIdentity()?.memberId)return
  const memberId=String((event as CustomEvent<{memberId?:string}>).detail?.memberId||'')
  void renderLocation(true).then(()=>{
    if(!memberId)return
    window.dispatchEvent(new CustomEvent('familia-noa:focus-location',{detail:{memberId}}))
  })
})

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
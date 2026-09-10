import './styles.css'
import { supabase } from './supabase'

type Member = { id: string; name: string; active: boolean }
const FALLBACK = ['Mamá', 'Papá', 'Romel', 'Osniel', 'Abner']
const KEY = 'familia-noa-member'
const PROFILE_KEY = 'familia-noa-profile'
let members: Member[] = []
let memberName = localStorage.getItem(KEY) || ''
let memberId = ''
let channel: ReturnType<typeof supabase.channel> | null = null
let settingsChannel: ReturnType<typeof supabase.channel> | null = null
let familySyncChannel: ReturnType<typeof supabase.channel> | null = null
const app = document.querySelector<HTMLDivElement>('#app')!
document.title = 'FAMILIA NOA'

const esc = (v: string) => v.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]!))
const time = (v: string) => new Date(v).toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})

async function loadMembers() {
  const { data } = await supabase.from('family_members').select('id,name,active').eq('active', true).order('created_at')
  members = (data || []) as Member[]
  if (!members.length) members = FALLBACK.map((name, i) => ({id:String(i), name, active:true}))
}

function login(errorText = '') {
  app.innerHTML = `<main class="login"><div class="brand"><span>FAMILIA</span><strong>NOA</strong></div><p class="eyebrow">PRIVATE FAMILY SPACE</p><h1>¿Quién eres?</h1><p class="intro">Un solo lugar para estar cerca, estés donde estés.</p>${errorText ? `<div class="errorbox">${esc(errorText)}</div>` : ''}<div class="members">${members.map(m=>`<button class="member" data-name="${esc(m.name)}">${esc(m.name)}<span>›</span></button>`).join('')}</div></main>`
  document.querySelectorAll<HTMLButtonElement>('[data-name]').forEach(b=>b.onclick=()=>securityStep(b.dataset.name!))
}

function securityStep(name: string) {
  const selected = members.find(m=>m.name===name)
  if (!selected) return
  app.innerHTML = `<main class="login"><button class="backlink" id="back">‹ Volver</button><div class="brand"><span>FAMILIA</span><strong>NOA</strong></div><p class="eyebrow">ACCESO FAMILIAR</p><h1>${esc(name)}</h1><p class="intro">Confirma tus datos para entrar.</p><form class="security-form" id="security"><label>Número de la casa de Trinidad<input id="house" inputmode="numeric" autocomplete="off" required></label><label>Tu apodo en la familia<input id="nickname" autocomplete="off" required></label><button class="primary" type="submit">Entrar</button></form><div id="securityError"></div></main>`
  document.querySelector('#back')!.addEventListener('click',()=>login())
  document.querySelector('#security')!.addEventListener('submit',async e=>{
    e.preventDefault()
    const house=(document.querySelector<HTMLInputElement>('#house')!).value.trim()
    const nickname=(document.querySelector<HTMLInputElement>('#nickname')!).value.trim()
    const error=document.querySelector('#securityError')!
    error.textContent='Verificando…'
    const {data,error:rpcError}=await supabase.rpc('login_by_family_credentials',{p_member_id:selected.id,p_house_number:house,p_nickname:nickname})
    if(rpcError||!data?.length){error.textContent='Datos incorrectos. Comprueba el número de la casa y tu apodo.';return}
    const profile=data[0] as {id:string;name:string}
    memberName=profile.name
    memberId=profile.id
    localStorage.setItem(KEY,memberName)
    sessionStorage.setItem(PROFILE_KEY,JSON.stringify(profile))
    renderHome();startSettingsRealtime();startFamilyRealtime()
  })
}

function applySettings(s:any){
  const root=document.documentElement
  if(s?.background) root.style.setProperty('--bg',s.background)
  if(s?.surface) root.style.setProperty('--surface',s.surface)
  if(s?.ink) root.style.setProperty('--ink',s.ink)
  if(s?.accent) root.style.setProperty('--accent',s.accent)
  if(s?.font==='sans') root.style.setProperty('--display-font','Inter, system-ui, sans-serif')
  else if(s?.font==='mono') root.style.setProperty('--display-font','ui-monospace, SFMono-Regular, Menlo, monospace')
  else root.style.setProperty('--display-font','Georgia, \"Times New Roman\", serif')
  const hero=document.querySelector('.hero h2'); if(hero&&s?.heroTitle) hero.textContent=s.heroTitle
  const heroText=document.querySelector('.hero p:not(.eyebrow)'); if(heroText&&s?.heroText) heroText.textContent=s.heroText
}

async function loadSettings(){
  const {data}=await supabase.from('app_settings').select('settings').eq('id','global').maybeSingle()
  if(data?.settings) applySettings(data.settings)
}
function startSettingsRealtime(){
  settingsChannel?.unsubscribe()
  settingsChannel=supabase.channel('familia-noa-settings').on('postgres_changes',{event:'UPDATE',schema:'public',table:'app_settings',filter:'id=eq.global'},payload=>applySettings((payload.new as any).settings)).subscribe()
}

function startFamilyRealtime(){
  familySyncChannel?.unsubscribe()
  familySyncChannel=supabase.channel('familia-noa-family-sync')
    .on('postgres_changes',{event:'*',schema:'public',table:'family_members'},async()=>{
      await loadMembers()
      const current=members.find(m=>m.id===memberId)
      if(!current){ localStorage.removeItem(KEY); sessionStorage.removeItem(PROFILE_KEY); memberName=''; memberId=''; login('Este perfil ya no está activo.') }
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'photos'},()=>{
      if(document.querySelector('[data-photo-page]')) renderPhotos()
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'locations'},()=>{
      if(document.querySelector('.family-locations')) loadLocations()
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'wellbeing_status'},()=>{})
    .on('postgres_changes',{event:'*',schema:'public',table:'help_alerts'},()=>{})
    .subscribe()
}

function renderHome() {
  app.innerHTML = `<main class="shell"><header class="top"><div><p class="eyebrow">FAMILIA NOA</p><h1>Hola, ${esc(memberName)} <span>♡</span></h1></div><button class="avatar" id="change">${esc(memberName.charAt(0))}</button></header><section class="hero"><p class="eyebrow">TODOS CERCA</p><h2>¿Cómo está la familia hoy?</h2><p>Habla, comparte y revisa que todos estén bien.</p></section><section class="grid"><button class="card dark" id="chat"><i>✦</i><b>Chat</b><small>Habla con todos</small></button><button class="card photo" id="photos"><i>◌</i><b>Fotos</b><small>Momentos de familia</small></button><button class="card" id="location"><i>⌖</i><b>Ubicación</b><small>Ver dónde estamos</small></button><button class="card ok" id="ok"><i>♥</i><b>Estoy bien</b><small>Avísale a la familia</small></button><button class="card help" id="help"><i>!</i><b>Ayuda</b><small>Necesito a mi familia</small></button></section><nav><button class="active">Inicio</button><button id="navchat">Chat</button><button id="navphotos">Fotos</button><button id="navlocation">Ubicación</button></nav></main>`
  applySettings({})
  document.querySelector('#change')!.addEventListener('click',()=>{localStorage.removeItem(KEY);sessionStorage.removeItem(PROFILE_KEY);memberName='';memberId='';familySyncChannel?.unsubscribe();settingsChannel?.unsubscribe();login()})
  document.querySelector('#chat')!.addEventListener('click',renderChat)
  document.querySelector('#navchat')!.addEventListener('click',renderChat)
  document.querySelector('#photos')!.addEventListener('click',renderPhotos)
  document.querySelector('#navphotos')!.addEventListener('click',renderPhotos)
  document.querySelector('#location')!.addEventListener('click',renderLocation)
  document.querySelector('#navlocation')!.addEventListener('click',renderLocation)
  document.querySelector('#ok')!.addEventListener('click',setWellbeing)
  document.querySelector('#help')!.addEventListener('click',sendHelp)
  loadSettings()
}

async function renderChat(){
  app.innerHTML=`<main class="page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Chat</h1></div></header><section class="messages" id="messages"><div class="loading">Cargando mensajes…</div></section><form class="composer" id="composer"><input id="message" maxlength="2000" placeholder="Escribe algo…" autocomplete="off"><button>Enviar</button></form></main>`
  document.querySelector('#back')!.addEventListener('click',renderHome)
  const list=document.querySelector('#messages')!
  const {data}=await supabase.from('messages').select('id,sender_id,body,created_at,sender:family_members(name)').order('created_at',{ascending:true}).limit(100)
  list.innerHTML=(data||[]).map((m:any)=>`<article class="bubble ${m.sender_id===memberId?'mine':''}"><b>${esc(m.sender?.name||'Familia')}</b><p>${esc(m.body)}</p><small>${time(m.created_at)}</small></article>`).join('')||'<div class="empty">Todavía no hay mensajes. Sé el primero ❤️</div>'
  list.scrollTop=list.scrollHeight
  document.querySelector('#composer')!.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector<HTMLInputElement>('#message')!;const body=input.value.trim();if(!body||!memberId)return;input.disabled=true;await supabase.from('messages').insert({sender_id:memberId,body});input.value='';input.disabled=false})
  channel?.unsubscribe();channel=supabase.channel('familia-noa-chat').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>renderChat()).subscribe()
}

async function setWellbeing(){if(!memberId)return;const {error}=await supabase.from('wellbeing_status').upsert({member_id:memberId,is_ok:true,updated_at:new Date().toISOString()});sheet(error?'No se pudo actualizar':'Estoy bien ❤️',error?'El estado no pudo guardarse todavía.':'La familia puede ver que estás bien.')}
async function sendHelp(){if(!memberId)return;const {error}=await supabase.from('help_alerts').insert({member_id:memberId,message:`${memberName} necesita ayuda.`});sheet(error?'No se pudo enviar':'Ayuda enviada',error?'Inténtalo de nuevo en un momento.':'La familia recibirá tu alerta.')}
async function renderLocation(){
  const mandatory=memberName==='Mamá'||memberName==='Papá'
  app.innerHTML=`<main class="page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación</h1></div></header><section class="locationbox"><div class="pin">⌖</div><h2>Compartir ubicación</h2><p id="locationtext">${mandatory?'La ubicación es necesaria para este perfil.':'Comparte tu ubicación con la familia cuando quieras.'}</p><button class="primary" id="sharelocation">${mandatory?'Activar ubicación':'Actualizar ubicación'}</button></section><section class="family-locations" id="familylocations"><div class="loading">Cargando…</div></section></main>`
  document.querySelector('#back')!.addEventListener('click',renderHome);document.querySelector('#sharelocation')!.addEventListener('click',shareLocation);await loadLocations()
}
async function shareLocation(){const text=document.querySelector('#locationtext')!;if(!navigator.geolocation){text.textContent='Este dispositivo no permite ubicación.';return}text.textContent='Obteniendo ubicación…';navigator.geolocation.getCurrentPosition(async p=>{if(memberId)await supabase.from('locations').upsert({member_id:memberId,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,updated_at:new Date().toISOString()});text.textContent=`Ubicación actualizada · precisión aproximada ${Math.round(p.coords.accuracy)} m.`;await loadLocations()},()=>{text.textContent='Necesitamos permiso para acceder a tu ubicación.'},{enableHighAccuracy:true,timeout:15000})}
async function loadLocations(){const el=document.querySelector('#familylocations');if(!el)return;const {data}=await supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at,family_members(name)').order('updated_at',{ascending:false});el.innerHTML=(data||[]).map((x:any)=>`<div class="locationrow"><b>${esc(x.family_members?.name||'Familia')}</b><small>Actualizado ${time(x.updated_at)} · ${Math.round(x.accuracy||0)} m</small><a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${x.latitude},${x.longitude}">Ver mapa ›</a></div>`).join('')||'<div class="empty">Aún no hay ubicaciones compartidas.</div>'}
function renderPhotos(){sheet('Fotos','El álbum privado se conectará a Supabase Storage en el siguiente bloque.')}
function sheet(title:string,text:string){const el=document.createElement('div');el.className='overlay';el.innerHTML=`<div class="sheet"><button class="close">×</button><p class="eyebrow">FAMILIA NOA</p><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="primary close">Entendido</button></div>`;document.body.appendChild(el);el.querySelectorAll('.close').forEach(x=>x.addEventListener('click',()=>el.remove()))}

async function start(){
  await loadMembers()
  const saved=sessionStorage.getItem(PROFILE_KEY)
  if(saved){
    try{
      const profile=JSON.parse(saved) as {id:string;name:string}
      const current=members.find(m=>m.id===profile.id&&m.name===profile.name)
      if(current){memberId=current.id;memberName=current.name;renderHome();startSettingsRealtime();startFamilyRealtime();return}
    }catch{}
    sessionStorage.removeItem(PROFILE_KEY)
  }
  login()
}
start()
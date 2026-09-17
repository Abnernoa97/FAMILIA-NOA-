import './styles.css'
import { supabase } from './supabase'
import { clearIdentity, getIdentity, setIdentity } from './core/identity'

type Member = { id: string; name: string; active: boolean; must_share_location: boolean }

type ChatMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  reply_to_id: string | null
  sender?: { name?: string } | null
}

const FALLBACK = ['Mamá', 'Papá', 'Romel', 'Osniel', 'Abner']
let members: Member[] = []
const initialIdentity = getIdentity()
let memberName = initialIdentity?.name || ''
let memberId = initialIdentity?.memberId || ''
let channel: ReturnType<typeof supabase.channel> | null = null
let settingsChannel: ReturnType<typeof supabase.channel> | null = null
let familySyncChannel: ReturnType<typeof supabase.channel> | null = null
let replyTo: { id:string; name:string; body:string } | null = null
let chatViewToken = 0
const app = document.querySelector<HTMLDivElement>('#app')!
document.title = 'FAMILIA NOA'

const esc = (v: string) => v.replace(/[&<>\\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#039;'}[c]!))
const time = (v: string) => new Date(v).toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})

async function loadMembers() {
  const { data } = await supabase.from('family_members').select('id,name,active,must_share_location').eq('active', true).order('created_at')
  members = (data || []) as Member[]
  if (!members.length) members = FALLBACK.map((name, i) => ({id:String(i), name, active:true, must_share_location:name==='Mamá'||name==='Papá'}))
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
    setIdentity({memberId:profile.id,name:profile.name})
    memberName=profile.name
    memberId=profile.id
    renderHome(); startSettingsRealtime(); startFamilyRealtime()
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
  else root.style.setProperty('--display-font','Georgia, \\"Times New Roman\\", serif')
  const hero=document.querySelector('.hero h2'); if(hero&&s?.heroTitle) hero.textContent=s.heroTitle
  const heroText=document.querySelector('.hero p:not(.eyebrow)'); if(heroText&&s?.heroText) heroText.textContent=s.heroText
}
async function loadSettings(){const {data}=await supabase.from('app_settings').select('settings').eq('id','global').maybeSingle();if(data?.settings)applySettings(data.settings)}
function startSettingsRealtime(){settingsChannel?.unsubscribe();settingsChannel=supabase.channel('familia-noa-settings').on('postgres_changes',{event:'UPDATE',schema:'public',table:'app_settings',filter:'id=eq.global'},payload=>applySettings((payload.new as any).settings)).subscribe()}
function startFamilyRealtime(){familySyncChannel?.unsubscribe();familySyncChannel=supabase.channel('familia-noa-family-sync').on('postgres_changes',{event:'*',schema:'public',table:'family_members'},async()=>{await loadMembers();const current=members.find(m=>m.id===memberId);if(!current){clearIdentity();memberName='';memberId='';login('Este perfil ya no está activo.')}}).on('postgres_changes',{event:'*',schema:'public',table:'locations'},()=>{if(document.querySelector('.family-locations'))loadLocations()}).subscribe()}

function stopChatRealtime(){
  chatViewToken++
  channel?.unsubscribe()
  channel=null
}

function renderHome(){
  stopChatRealtime()
  app.innerHTML=`<main class="shell"><header class="top"><div><p class="eyebrow">FAMILIA NOA</p><h1>Hola, ${esc(memberName)} <span>♡</span></h1></div><button class="avatar" id="change">${esc(memberName.charAt(0))}</button></header><section class="hero"><p class="eyebrow">TODOS CERCA</p><h2>¿Cómo está la familia hoy?</h2><p>Habla, comparte y revisa que todos estén bien.</p></section><section class="grid"><button class="card dark" id="chat"><i>✦</i><b>Chat</b><small>Habla con todos</small></button><button class="card photo" id="photos"><i>◌</i><b>Fotos</b><small>Momentos de familia</small></button><button class="card" id="location"><i>⌖</i><b>Ubicación</b><small>Ver dónde estamos</small></button><button class="card ok" id="ok"><i>♥</i><b>Estoy bien</b><small>Avísale a la familia</small></button><button class="card help" id="help"><i>!</i><b>Ayuda</b><small>Necesito a mi familia</small></button></section><nav><button class="active">Inicio</button><button id="navchat">Chat</button><button id="navphotos">Fotos</button><button id="navlocation">Ubicación</button></nav></main>`
  applySettings({})
  document.querySelector('#change')!.addEventListener('click',()=>{clearIdentity();memberName='';memberId='';familySyncChannel?.unsubscribe();settingsChannel?.unsubscribe();stopChatRealtime();login()})
  document.querySelector('#chat')!.addEventListener('click',renderChat);document.querySelector('#navchat')!.addEventListener('click',renderChat);document.querySelector('#photos')!.addEventListener('click',renderPhotos);document.querySelector('#navphotos')!.addEventListener('click',renderPhotos);document.querySelector('#location')!.addEventListener('click',renderLocation);document.querySelector('#navlocation')!.addEventListener('click',renderLocation);document.querySelector('#ok')!.addEventListener('click',setWellbeing);document.querySelector('#help')!.addEventListener('click',sendHelp);loadSettings()
}

function chatBubble(m: ChatMessage, quoted: ChatMessage | null = null): string {
  return `<article class="bubble ${m.sender_id===memberId?'mine':''}" data-message-id="${esc(m.id)}"><div class="swipe-hint" aria-hidden="true">↩</div>${quoted?`<button class="quoted" data-jump="${esc(quoted.id)}"><b>${esc(quoted.sender?.name||'Familia')}</b><span>${esc(quoted.body)}</span></button>`:''}<b class="sender-name">${esc(m.sender?.name||'Familia')}</b><p>${esc(m.body)}</p><small>${time(m.created_at)}</small></article>`
}

async function renderChat(){
  stopChatRealtime()
  const viewToken=++chatViewToken
  replyTo=null
  app.innerHTML=`<main class="page chat-page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Chat</h1></div></header><section class="messages" id="messages"><div class="loading">Cargando mensajes…</div></section><div id="replyPreview"></div><form class="composer" id="composer"><input id="message" maxlength="2000" placeholder="Escribe algo…" autocomplete="off"><button>Enviar</button></form><button class="back-to-top" id="chatTop" aria-label="Volver arriba">↑</button></main>`
  document.querySelector('#back')!.addEventListener('click',renderHome)
  const list=document.querySelector<HTMLElement>('#messages')!
  const {data,error}=await supabase.from('messages').select('id,sender_id,body,created_at,reply_to_id,sender:family_members(name)').order('created_at',{ascending:true}).limit(100)
  if(viewToken!==chatViewToken||!document.querySelector('#messages'))return
  const all: ChatMessage[]=(data||[]) as ChatMessage[]
  const byId=new Map(all.map(m=>[m.id,m]))
  list.innerHTML=all.map(m=>chatBubble(m,m.reply_to_id?byId.get(m.reply_to_id)||null:null)).join('')||'<div class="empty">Todavía no hay mensajes. Sé el primero ❤️</div>'
  list.scrollTop=list.scrollHeight

  const preview=document.querySelector('#replyPreview')!
  const input=document.querySelector<HTMLInputElement>('#message')!
  const updatePreview=()=>{
    preview.innerHTML=replyTo?`<div class="reply-preview"><div><b>Respondiendo a ${esc(replyTo.name)}</b><span>${esc(replyTo.body)}</span></div><button id="cancelReply" aria-label="Cancelar respuesta">×</button></div>`:''
    if(replyTo){
      document.querySelector('#cancelReply')!.addEventListener('click',()=>{replyTo=null;updatePreview();input.focus()})
    }
  }
  const selectReply=(m: ChatMessage)=>{replyTo={id:m.id,name:m.sender?.name||'Familia',body:m.body};updatePreview();input.focus()}
  const getMessage=(id:string)=>byId.get(id)

  let swipeId=''
  let startX=0
  let startY=0
  let swiping=false
  list.addEventListener('touchstart',e=>{
    const target=(e.target as HTMLElement).closest<HTMLElement>('.bubble')
    if(!target)return
    const t=e.touches[0]
    swipeId=target.dataset.messageId||''
    startX=t.clientX
    startY=t.clientY
    swiping=false
  },{passive:true})
  list.addEventListener('touchmove',e=>{
    if(!swipeId)return
    const target=list.querySelector<HTMLElement>(`[data-message-id="${swipeId}"]`)
    if(!target)return
    const t=e.touches[0]
    const dx=t.clientX-startX
    const dy=Math.abs(t.clientY-startY)
    if(dx>8&&dx>dy){swiping=true;target.style.transform=`translateX(${Math.min(dx,72)}px)`}
  },{passive:true})
  list.addEventListener('touchend',()=>{
    if(!swipeId)return
    const target=list.querySelector<HTMLElement>(`[data-message-id="${swipeId}"]`)
    if(target&&swiping){
      const m=getMessage(swipeId)
      if(m&&parseFloat(target.style.transform.replace(/[^0-9.-]/g,''))>=55)selectReply(m)
      target.style.transform=''
    }
    swipeId='';swiping=false
  })
  list.addEventListener('dblclick',e=>{
    const target=(e.target as HTMLElement).closest<HTMLElement>('.bubble')
    if(!target)return
    const m=getMessage(target.dataset.messageId||'')
    if(m)selectReply(m)
  })
  list.addEventListener('click',e=>{
    const quoted=(e.target as HTMLElement).closest<HTMLElement>('[data-jump]')
    if(!quoted)return
    const id=quoted.dataset.jump
    if(id)list.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})
  })

  document.querySelector('#composer')!.addEventListener('submit',async e=>{
    e.preventDefault()
    const body=input.value.trim()
    if(!body||!memberId)return
    input.disabled=true
    const payload:any={sender_id:memberId,body}
    if(replyTo)payload.reply_to_id=replyTo.id
    const {error:insertError}=await supabase.from('messages').insert(payload)
    input.disabled=false
    if(insertError){sheet('No se pudo enviar','Inténtalo de nuevo en un momento.');return}
    input.value='';replyTo=null;updatePreview();input.focus()
  })
  document.querySelector('#chatTop')!.addEventListener('click',()=>list.scrollTo({top:0,behavior:'smooth'}))

  const seenIds=new Set(all.map(m=>m.id))
  channel=supabase.channel('familia-noa-chat').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},async payload=>{
    if(viewToken!==chatViewToken)return
    const row=payload.new as {id:string;sender_id:string;body:string;created_at:string;reply_to_id:string|null}
    if(!row?.id||seenIds.has(row.id))return
    seenIds.add(row.id)

    let senderName=members.find(m=>m.id===row.sender_id)?.name||''
    if(!senderName){
      const {data:sender}=await supabase.from('family_members').select('name').eq('id',row.sender_id).maybeSingle()
      senderName=sender?.name||'Familia'
    }
    if(viewToken!==chatViewToken)return

    const wasNearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<120
    const message:ChatMessage={...row,sender:{name:senderName}}
    byId.set(message.id,message)
    const empty=list.querySelector('.empty')
    if(empty)empty.remove()
    list.insertAdjacentHTML('beforeend',chatBubble(message,message.reply_to_id?byId.get(message.reply_to_id)||null:null))
    if(wasNearBottom)list.scrollTop=list.scrollHeight
  }).subscribe()
}

async function setWellbeing(){if(!memberId)return;const {error}=await supabase.from('wellbeing_status').upsert({member_id:memberId,is_ok:true,updated_at:new Date().toISOString()});sheet(error?'No se pudo actualizar':'Estoy bien ❤️',error?'El estado no pudo guardarse todavía.':'La familia puede ver que estás bien.')}
async function sendHelp(){if(!memberId)return;const {error}=await supabase.from('help_alerts').insert({member_id:memberId,message:`${memberName} necesita ayuda.`});sheet(error?'No se pudo enviar':'Ayuda enviada',error?'Inténtalo de nuevo en un momento.':'La familia recibirá tu alerta.')}

async function renderPhotos(){
  app.innerHTML='<main class="page photo-page" data-photo-page><div class="loading">Cargando álbumes…</div></main>'
}

async function renderLocation(){const current=members.find(m=>m.id===memberId);const mandatory=!!current?.must_share_location;app.innerHTML=`<main class="page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación</h1></div></header><section class="locationbox"><div class="pin">⌖</div><h2>Compartir ubicación</h2><p id="locationtext">${mandatory?'La ubicación es necesaria para este perfil.':'Comparte tu ubicación con la familia cuando quieras.'}</p><button class="primary" id="sharelocation">${mandatory?'Activar ubicación':'Actualizar ubicación'}</button></section><section class="family-locations" id="familylocations"><div class="loading">Cargando…</div></section></main>`;document.querySelector('#back')!.addEventListener('click',renderHome);document.querySelector('#sharelocation')!.addEventListener('click',shareLocation);await loadLocations()}
async function shareLocation(){const text=document.querySelector('#locationtext')!;if(!navigator.geolocation){text.textContent='Este dispositivo no permite ubicación.';return}text.textContent='Obteniendo ubicación…';navigator.geolocation.getCurrentPosition(async p=>{if(memberId)await supabase.from('locations').upsert({member_id:memberId,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,updated_at:new Date().toISOString()});text.textContent=`Ubicación actualizada · precisión aproximada ${Math.round(p.coords.accuracy)} m.`;await loadLocations()},()=>{text.textContent='Necesitamos permiso para acceder a tu ubicación.'},{enableHighAccuracy:true,timeout:15000})}
async function loadLocations(){const el=document.querySelector('#familylocations');if(!el)return;const {data}=await supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at,family_members(name)').order('updated_at',{ascending:false});el.innerHTML=(data||[]).map((x:any)=>`<div class="locationrow"><b>${esc(x.family_members?.name||'Familia')}</b><small>Actualizado ${time(x.updated_at)} · ${Math.round(x.accuracy||0)} m</small><a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${x.latitude},${x.longitude}">Ver mapa ›</a></div>`).join('')||'<div class="empty">Aún no hay ubicaciones compartidas.</div>'}

function sheet(title:string,text:string){const el=document.createElement('div');el.className='overlay';el.innerHTML=`<div class="sheet"><button class="close">×</button><p class="eyebrow">FAMILIA NOA</p><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;document.body.appendChild(el);el.querySelector('.close')!.addEventListener('click',()=>el.remove());el.addEventListener('click',e=>{if(e.target===el)el.remove()})}

async function boot(){
  await loadMembers()
  const identity=getIdentity()
  if(identity&&members.some(m=>m.id===identity.memberId)){
    memberId=identity.memberId;memberName=identity.name;renderHome();startSettingsRealtime();startFamilyRealtime();return
  }
  if(identity)clearIdentity()
  memberName='';memberId='';login()
}
boot()

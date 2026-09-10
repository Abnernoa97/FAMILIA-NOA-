import './styles.css'
import { supabase } from './supabase'

type Member = { id: string; name: string; active: boolean; must_share_location: boolean }
type Photo = { id: string; uploader_id: string; storage_path: string; caption: string | null; created_at: string; mime_type?: string | null; file_size?: number | null; width?: number | null; height?: number | null; uploader?: { name: string } | null }

const FALLBACK = ['Mamá', 'Papá', 'Romel', 'Osniel', 'Abner']
const KEY = 'familia-noa-member'
const PROFILE_KEY = 'familia-noa-profile'
const PHOTO_BUCKET = 'family-photos'
const MAX_PHOTOS_PER_MEMBER = 10
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 1600
let members: Member[] = []
let memberName = localStorage.getItem(KEY) || ''
let memberId = ''
let channel: ReturnType<typeof supabase.channel> | null = null
let settingsChannel: ReturnType<typeof supabase.channel> | null = null
let familySyncChannel: ReturnType<typeof supabase.channel> | null = null
let replyTo: { id:string; name:string; body:string } | null = null
const app = document.querySelector<HTMLDivElement>('#app')!
document.title = 'FAMILIA NOA'

const esc = (v: string) => v.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]!))
const time = (v: string) => new Date(v).toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})
const mb = (bytes:number) => `${(bytes / 1048576).toFixed(bytes >= 1048576 ? 1 : 2)} MB`

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
    memberName=profile.name
    memberId=profile.id
    localStorage.setItem(KEY,memberName)
    sessionStorage.setItem(PROFILE_KEY,JSON.stringify(profile))
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
  else root.style.setProperty('--display-font','Georgia, \"Times New Roman\", serif')
  const hero=document.querySelector('.hero h2'); if(hero&&s?.heroTitle) hero.textContent=s.heroTitle
  const heroText=document.querySelector('.hero p:not(.eyebrow)'); if(heroText&&s?.heroText) heroText.textContent=s.heroText
}
async function loadSettings(){const {data}=await supabase.from('app_settings').select('settings').eq('id','global').maybeSingle();if(data?.settings)applySettings(data.settings)}
function startSettingsRealtime(){settingsChannel?.unsubscribe();settingsChannel=supabase.channel('familia-noa-settings').on('postgres_changes',{event:'UPDATE',schema:'public',table:'app_settings',filter:'id=eq.global'},payload=>applySettings((payload.new as any).settings)).subscribe()}
function startFamilyRealtime(){familySyncChannel?.unsubscribe();familySyncChannel=supabase.channel('familia-noa-family-sync').on('postgres_changes',{event:'*',schema:'public',table:'family_members'},async()=>{await loadMembers();const current=members.find(m=>m.id===memberId);if(!current){localStorage.removeItem(KEY);sessionStorage.removeItem(PROFILE_KEY);memberName='';memberId='';login('Este perfil ya no está activo.')}}).on('postgres_changes',{event:'*',schema:'public',table:'photos'},()=>{if(document.querySelector('[data-photo-page]'))renderPhotos()}).on('postgres_changes',{event:'*',schema:'public',table:'locations'},()=>{if(document.querySelector('.family-locations'))loadLocations()}).on('postgres_changes',{event:'*',schema:'public',table:'wellbeing_status'},()=>{}).on('postgres_changes',{event:'*',schema:'public',table:'help_alerts'},()=>{}).subscribe()}

function renderHome(){
  app.innerHTML=`<main class="shell"><header class="top"><div><p class="eyebrow">FAMILIA NOA</p><h1>Hola, ${esc(memberName)} <span>♡</span></h1></div><button class="avatar" id="change">${esc(memberName.charAt(0))}</button></header><section class="hero"><p class="eyebrow">TODOS CERCA</p><h2>¿Cómo está la familia hoy?</h2><p>Habla, comparte y revisa que todos estén bien.</p></section><section class="grid"><button class="card dark" id="chat"><i>✦</i><b>Chat</b><small>Habla con todos</small></button><button class="card photo" id="photos"><i>◌</i><b>Fotos</b><small>Momentos de familia</small></button><button class="card" id="location"><i>⌖</i><b>Ubicación</b><small>Ver dónde estamos</small></button><button class="card ok" id="ok"><i>♥</i><b>Estoy bien</b><small>Avísale a la familia</small></button><button class="card help" id="help"><i>!</i><b>Ayuda</b><small>Necesito a mi familia</small></button></section><nav><button class="active">Inicio</button><button id="navchat">Chat</button><button id="navphotos">Fotos</button><button id="navlocation">Ubicación</button></nav></main>`
  applySettings({})
  document.querySelector('#change')!.addEventListener('click',()=>{localStorage.removeItem(KEY);sessionStorage.removeItem(PROFILE_KEY);memberName='';memberId='';familySyncChannel?.unsubscribe();settingsChannel?.unsubscribe();login()})
  document.querySelector('#chat')!.addEventListener('click',renderChat);document.querySelector('#navchat')!.addEventListener('click',renderChat);document.querySelector('#photos')!.addEventListener('click',renderPhotos);document.querySelector('#navphotos')!.addEventListener('click',renderPhotos);document.querySelector('#location')!.addEventListener('click',renderLocation);document.querySelector('#navlocation')!.addEventListener('click',renderLocation);document.querySelector('#ok')!.addEventListener('click',setWellbeing);document.querySelector('#help')!.addEventListener('click',sendHelp);loadSettings()
}

async function renderChat(){
  replyTo=null
  app.innerHTML=`<main class="page chat-page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Chat</h1></div></header><section class="messages" id="messages"><div class="loading">Cargando mensajes…</div></section><div id="replyPreview"></div><form class="composer" id="composer"><input id="message" maxlength="2000" placeholder="Escribe algo…" autocomplete="off"><button>Enviar</button></form><button class="back-to-top" id="chatTop" aria-label="Volver arriba">↑</button></main>`
  document.querySelector('#back')!.addEventListener('click',renderHome)
  const list=document.querySelector('#messages')!
  const {data}=await supabase.from('messages').select('id,sender_id,body,created_at,reply_to_id,sender:family_members(name)').order('created_at',{ascending:true}).limit(100)
  const all:any[]=data||[]
  const byId=new Map(all.map(m=>[m.id,m]))
  list.innerHTML=all.map(m=>{const quoted=m.reply_to_id?byId.get(m.reply_to_id):null;return `<article class="bubble ${m.sender_id===memberId?'mine':''}" data-message-id="${m.id}"><div class="swipe-hint" aria-hidden="true">↩</div>${quoted?`<button class="quoted" data-jump="${quoted.id}"><b>${esc(quoted.sender?.name||'Familia')}</b><span>${esc(quoted.body)}</span></button>`:''}<b class="sender-name">${esc(m.sender?.name||'Familia')}</b><p>${esc(m.body)}</p><small>${time(m.created_at)}</small></article>`}).join('')||'<div class="empty">Todavía no hay mensajes. Sé el primero ❤️</div>'
  list.scrollTop=list.scrollHeight
  const preview=document.querySelector('#replyPreview')!
  const updatePreview=()=>{preview.innerHTML=replyTo?`<div class="reply-preview"><div><b>Respondiendo a ${esc(replyTo.name)}</b><span>${esc(replyTo.body)}</span></div><button id="cancelReply" aria-label="Cancelar respuesta">×</button></div>`:'';if(replyTo){document.querySelector('#cancelReply')!.addEventListener('click',()=>{replyTo=null;updatePreview();document.querySelector<HTMLInputElement>('#message')!.focus()})}}
  const selectReply=(m:any)=>{replyTo={id:m.id,name:m.sender?.name||'Familia',body:m.body};updatePreview();document.querySelector<HTMLInputElement>('#message')!.focus()}
  document.querySelectorAll<HTMLElement>('.bubble').forEach(b=>{let startX=0,startY=0,moved=false;b.addEventListener('touchstart',e=>{const t=e.touches[0];startX=t.clientX;startY=t.clientY;moved=false},{passive:true});b.addEventListener('touchmove',e=>{const t=e.touches[0];const dx=t.clientX-startX;const dy=Math.abs(t.clientY-startY);if(dx>8&&dx>dy){moved=true;b.style.transform=`translateX(${Math.min(dx,72)}px)`}}, {passive:true});b.addEventListener('touchend',()=>{if(moved&&parseFloat(b.style.transform.replace(/[^0-9.-]/g,''))>=55){const m=all.find(x=>x.id===b.dataset.messageId);if(m)selectReply(m)}b.style.transform='';moved=false});b.addEventListener('dblclick',()=>{const m=all.find(x=>x.id===b.dataset.messageId);if(m)selectReply(m)})})
  document.querySelectorAll<HTMLElement>('[data-jump]').forEach(q=>q.addEventListener('click',()=>{document.querySelector(`[data-message-id="${q.dataset.jump}"]`)?.scrollIntoView({behavior:'smooth',block:'center'})}))
  document.querySelector('#composer')!.addEventListener('submit',async e=>{e.preventDefault();const input=document.querySelector<HTMLInputElement>('#message')!;const body=input.value.trim();if(!body||!memberId)return;input.disabled=true;const payload:any={sender_id:memberId,body};if(replyTo)payload.reply_to_id=replyTo.id;const {error}=await supabase.from('messages').insert(payload);input.disabled=false;if(error){sheet('No se pudo enviar','Inténtalo de nuevo en un momento.');return}input.value='';replyTo=null;updatePreview()})
  document.querySelector('#chatTop')!.addEventListener('click',()=>list.scrollTo({top:0,behavior:'smooth'}))
  channel?.unsubscribe();channel=supabase.channel('familia-noa-chat').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},()=>renderChat()).subscribe()
}

async function setWellbeing(){if(!memberId)return;const {error}=await supabase.from('wellbeing_status').upsert({member_id:memberId,is_ok:true,updated_at:new Date().toISOString()});sheet(error?'No se pudo actualizar':'Estoy bien ❤️',error?'El estado no pudo guardarse todavía.':'La familia puede ver que estás bien.')}
async function sendHelp(){if(!memberId)return;const {error}=await supabase.from('help_alerts').insert({member_id:memberId,message:`${memberName} necesita ayuda.`});sheet(error?'No se pudo enviar':'Ayuda enviada',error?'Inténtalo de nuevo en un momento.':'La familia recibirá tu alerta.')}

async function compressImage(file: File){
  if(!file.type.startsWith('image/')) throw new Error('Solo se pueden subir fotos.')
  if(file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} supera 15 MB.`)
  const bitmap = await createImageBitmap(file, {imageOrientation:'from-image'} as any)
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const ctx=canvas.getContext('2d')
  if(!ctx){bitmap.close();throw new Error('No se pudo preparar la foto.')}
  ctx.drawImage(bitmap,0,0,width,height);bitmap.close()
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.72))
  if(!blob) throw new Error(`No se pudo comprimir ${file.name}.`)
  return {blob,width,height}
}

async function getPhotoCount(){const {count,error}=await supabase.from('photos').select('id',{count:'exact',head:true}).eq('uploader_id',memberId);if(error)throw error;return count||0}

async function uploadPhotos(files:FileList|File[]){
  const selected=Array.from(files)
  if(!selected.length)return
  const existing=await getPhotoCount()
  const remaining=MAX_PHOTOS_PER_MEMBER-existing
  if(remaining<=0){sheet('Límite alcanzado','Ya tienes 10 fotos guardadas. Desde el administrador puedes borrar fotos y liberar espacio para subir nuevas.');return}
  if(selected.length>remaining){sheet('Máximo 10 fotos',`Ya tienes ${existing}. Solo puedes subir ${remaining} foto${remaining===1?'':'s'} más.`);return}
  const status=document.querySelector('#photoStatus')
  const button=document.querySelector<HTMLButtonElement>('#photoUploadButton')
  if(button)button.disabled=true
  if(status)status.textContent='Comprimiendo y subiendo…'
  for(const file of selected){
    let uploadedPath=''
    try{
      const compressed=await compressImage(file)
      if(compressed.blob.size>MAX_IMAGE_BYTES)throw new Error(`${file.name} no pudo reducirse lo suficiente.`)
      uploadedPath=`${memberId}/${crypto.randomUUID()}.jpg`
      const {error:uploadError}=await supabase.storage.from(PHOTO_BUCKET).upload(uploadedPath,compressed.blob,{contentType:'image/jpeg',cacheControl:'31536000',upsert:false})
      if(uploadError)throw uploadError
      const {error:dbError}=await supabase.from('photos').insert({uploader_id:memberId,storage_path:uploadedPath,mime_type:'image/jpeg',file_size:compressed.blob.size,width:compressed.width,height:compressed.height})
      if(dbError){await supabase.storage.from(PHOTO_BUCKET).remove([uploadedPath]);if(dbError.message?.includes('PHOTO_LIMIT_REACHED'))throw new Error('Llegaste al máximo de 10 fotos.');throw dbError}
    }catch(err:any){
      if(status)status.textContent=err?.message||'No se pudo subir una foto.'
      break
    }
  }
  if(button)button.disabled=false
  if(status&&!status.textContent?.startsWith('No')&&!status.textContent?.includes('máximo')&&!status.textContent?.includes('Llegaste'))status.textContent='Listo. Las fotos se guardaron comprimidas.'
  await renderPhotos()
}

async function renderPhotos(){
  app.innerHTML=`<main class="page photo-page" data-photo-page><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Fotos</h1></div></header><section class="photos-intro"><div><p class="eyebrow">ÁLBUM FAMILIAR</p><h2>Momentos de la familia.</h2><p>Cada persona puede guardar hasta 10 fotos. Antes de subirlas, la app reduce automáticamente la resolución y el peso.</p></div><label class="photo-upload"><input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden><span>＋</span><b>Subir fotos</b><small id="photoStatus">Hasta 10 por persona</small></label></section><section class="photo-grid" id="photoGrid"><div class="loading">Cargando fotos…</div></section></main>`
  document.querySelector('#back')!.addEventListener('click',renderHome)
  document.querySelector('#photoInput')!.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.files)uploadPhotos(input.files);input.value=''})
  const {data,error}=await supabase.from('photos').select('id,uploader_id,storage_path,caption,created_at,mime_type,file_size,width,height,uploader:family_members(name)').order('created_at',{ascending:false}).limit(100)
  const grid=document.querySelector('#photoGrid')!
  if(error){grid.innerHTML='<div class="empty">No se pudo cargar el álbum.</div>';return}
  const photos=(data||[]) as unknown as Photo[]
  grid.innerHTML=photos.map(p=>{const {data:urlData}=supabase.storage.from(PHOTO_BUCKET).getPublicUrl(p.storage_path);return `<figure class="photo-item"><img src="${esc(urlData.publicUrl)}" alt="Foto de ${esc(p.uploader?.name||'familia')}" loading="lazy"><figcaption><b>${esc(p.uploader?.name||'Familia')}</b><small>${time(p.created_at)}${p.file_size?` · ${mb(p.file_size)}`:''}</small></figcaption></figure>`}).join('')||'<div class="empty">Todavía no hay fotos. Súbela tú primero ❤️</div>'
}

async function renderLocation(){const current=members.find(m=>m.id===memberId);const mandatory=!!current?.must_share_location;app.innerHTML=`<main class="page"><header class="pagehead"><button id="back">‹</button><div><p class="eyebrow">FAMILIA NOA</p><h1>Ubicación</h1></div></header><section class="locationbox"><div class="pin">⌖</div><h2>Compartir ubicación</h2><p id="locationtext">${mandatory?'La ubicación es necesaria para este perfil.':'Comparte tu ubicación con la familia cuando quieras.'}</p><button class="primary" id="sharelocation">${mandatory?'Activar ubicación':'Actualizar ubicación'}</button></section><section class="family-locations" id="familylocations"><div class="loading">Cargando…</div></section></main>`;document.querySelector('#back')!.addEventListener('click',renderHome);document.querySelector('#sharelocation')!.addEventListener('click',shareLocation);await loadLocations()}
async function shareLocation(){const text=document.querySelector('#locationtext')!;if(!navigator.geolocation){text.textContent='Este dispositivo no permite ubicación.';return}text.textContent='Obteniendo ubicación…';navigator.geolocation.getCurrentPosition(async p=>{if(memberId)await supabase.from('locations').upsert({member_id:memberId,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,updated_at:new Date().toISOString()});text.textContent=`Ubicación actualizada · precisión aproximada ${Math.round(p.coords.accuracy)} m.`;await loadLocations()},()=>{text.textContent='Necesitamos permiso para acceder a tu ubicación.'},{enableHighAccuracy:true,timeout:15000})}
async function loadLocations(){const el=document.querySelector('#familylocations');if(!el)return;const {data}=await supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at,family_members(name)').order('updated_at',{ascending:false});el.innerHTML=(data||[]).map((x:any)=>`<div class="locationrow"><b>${esc(x.family_members?.name||'Familia')}</b><small>Actualizado ${time(x.updated_at)} · ${Math.round(x.accuracy||0)} m</small><a target="_blank" rel="noreferrer" href="https://www.google.com/maps?q=${x.latitude},${x.longitude}">Ver mapa ›</a></div>`).join('')||'<div class="empty">Aún no hay ubicaciones compartidas.</div>'}

function sheet(title:string,text:string){const el=document.createElement('div');el.className='overlay';el.innerHTML=`<div class="sheet"><button class="close">×</button><p class="eyebrow">FAMILIA NOA</p><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;document.body.appendChild(el);el.querySelector('.close')!.addEventListener('click',()=>el.remove());el.addEventListener('click',e=>{if(e.target===el)el.remove()})}

async function boot(){
  await loadMembers()
  const stored=sessionStorage.getItem(PROFILE_KEY)
  if(stored){try{const profile=JSON.parse(stored) as {id:string;name:string};if(members.some(m=>m.id===profile.id)){memberId=profile.id;memberName=profile.name;renderHome();startSettingsRealtime();startFamilyRealtime();return}}catch{sessionStorage.removeItem(PROFILE_KEY)}}
  memberName='';memberId='';login()
}
boot()

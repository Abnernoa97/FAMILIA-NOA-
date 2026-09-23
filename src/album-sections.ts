import { supabase } from './supabase'
import { mediaUrl, primeMedia, signMedia } from './core/private-media'
import { openMediaViewer } from './core/media-viewer'
import { enterView } from './core/navigation'

type Section='photos'|'chat'|'presume'
type Member={id:string;name:string}
type ChatRow={
  id:string
  sender_id:string
  body:string
  created_at:string
  deleted_at:string|null
  attachment_path:string|null
  attachment_type:string|null
  attachment_name:string|null
}
type PostRow={
  id:string
  member_id:string
  media_type:'image'|'video'|'text'|'audio'
  media_path:string|null
  body:string
  prompt_slot:'morning'|'afternoon'|null
  prompt_date:string|null
  created_at:string
}

const CHAT_LIMIT=120
const POST_LIMIT=120
let activeSection:Section='photos'
let mountedMemberId=''
let mountedRoot:HTMLElement|null=null
let channel:ReturnType<typeof supabase.channel>|null=null
let refreshTimer:number|null=null

const esc=(value:string)=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))
const fmtDay=(value:string)=>new Date(value).toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'})
const fmtTime=(value:string)=>new Date(value).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})

function injectStyles(){
  if(document.querySelector('#family-album-sections-css'))return
  const style=document.createElement('style')
  style.id='family-album-sections-css'
  style.textContent=`
  .album-section-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:4px;margin:-4px 0 18px;border-radius:18px;background:#ece7de}
  .album-section-tab{height:40px;border:0;border-radius:14px;background:transparent;color:#777169;font:700 11px system-ui;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s}
  .album-section-tab.active{background:#fff;color:#171716;box-shadow:0 3px 14px rgba(33,29,23,.07)}
  .album-section-panel{display:grid;gap:10px}.album-section-panel[hidden]{display:none}
  .album-archive-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:2px 1px 9px}.album-archive-head h2{margin:0;font:500 24px var(--display-font,Georgia,serif)}.album-archive-head span{font:700 9px system-ui;letter-spacing:.08em;color:#9a948b;text-transform:uppercase}
  .album-archive-empty{padding:38px 18px;border:1px dashed #d9d2c7;border-radius:20px;text-align:center;color:#837d74;font:12px/1.5 system-ui}.album-archive-empty b{display:block;margin-bottom:5px;color:#171716;font:500 20px var(--display-font,Georgia,serif)}
  .album-day{margin:10px 2px 0;color:#969087;font:700 9px system-ui;letter-spacing:.09em;text-transform:uppercase}
  .album-chat-item,.album-presume-item{overflow:hidden;border:1px solid #e4ded4;border-radius:19px;background:#fff;box-shadow:0 4px 18px rgba(22,19,15,.03)}
  .album-chat-copy{padding:12px 13px 11px}.album-chat-copy p{margin:0;color:#2b2926;font:13px/1.45 system-ui;white-space:pre-wrap}.album-chat-copy small,.album-presume-meta{display:block;margin-top:7px;color:#9a948b;font:9px system-ui}
  .album-archive-media{display:block;width:100%;border:0;padding:0;background:#ece7de;color:#171716;cursor:pointer;text-align:left;overflow:hidden}.album-archive-media img{display:block;width:100%;max-height:420px;object-fit:cover}.album-video-card{min-height:120px;display:grid;place-items:center;background:#1b1b1a;color:#fff;font:700 11px system-ui;letter-spacing:.08em}.album-video-card span{width:48px;height:48px;border-radius:50%;background:#fff;color:#171716;display:grid;place-items:center;font-size:18px;margin-bottom:7px}.album-audio{padding:12px 13px;background:#f2eee7}.album-audio audio{display:block;width:100%;height:38px}
  .album-presume-body{padding:13px}.album-presume-body p{margin:0;font:500 18px/1.3 var(--display-font,Georgia,serif);white-space:pre-wrap}.album-presume-text{padding:30px 20px;background:linear-gradient(145deg,#f3dbc7,#ddd6f0);font:500 23px/1.22 var(--display-font,Georgia,serif);text-align:center;white-space:pre-wrap}.album-presume-slot{display:inline-flex;margin-bottom:8px;padding:5px 7px;border-radius:999px;background:#f1ede6;color:#777169;font:700 8px system-ui;letter-spacing:.08em;text-transform:uppercase}
  .album-archive-loading{padding:34px;text-align:center;color:#908a82;font:11px system-ui}
  @media(max-width:430px){.album-section-tabs{margin-top:-6px}.album-section-tab{height:38px;font-size:10px}.album-chat-copy p{font-size:12px}.album-presume-body p{font-size:17px}}
  `
  document.head.appendChild(style)
}

function currentAlbumRoot(){
  const root=document.querySelector<HTMLElement>('[data-photo-page].albums-page')
  if(!root||!root.querySelector('#albumBack')||!root.querySelector('.album-title-row'))return null
  return root
}

async function resolveMember(root:HTMLElement):Promise<Member|null>{
  const title=root.querySelector<HTMLElement>('.album-title-row h1')?.textContent?.trim()||''
  const name=title.replace(/^Álbum de\s+/i,'').trim()
  if(!name)return null
  const {data,error}=await supabase.from('family_members').select('id,name').eq('name',name).eq('active',true).maybeSingle()
  if(error||!data)return null
  return data as Member
}

function nativePhotoNodes(root:HTMLElement){
  return [
    root.querySelector<HTMLElement>('.album-actions'),
    root.querySelector<HTMLElement>('#memberAlbumStatus'),
    root.querySelector<HTMLElement>('.album-photo-grid'),
    ...Array.from(root.querySelectorAll<HTMLElement>('.album-empty-state')),
    root.querySelector<HTMLElement>('.album-selection-bar')
  ].filter((node):node is HTMLElement=>!!node&&!node.closest('[data-album-archive]'))
}

function toggleNativePhotos(root:HTMLElement,show:boolean){
  nativePhotoNodes(root).forEach(node=>{node.hidden=!show})
}

function updateTabs(root:HTMLElement){
  root.querySelectorAll<HTMLButtonElement>('[data-album-section]').forEach(button=>button.classList.toggle('active',button.dataset.albumSection===activeSection))
  const archive=root.querySelector<HTMLElement>('[data-album-archive]')
  if(archive)archive.hidden=activeSection==='photos'
  toggleNativePhotos(root,activeSection==='photos')
}

function dayBlocks<T extends {created_at:string}>(items:T[],render:(item:T)=>string){
  let day=''
  return items.map(item=>{
    const next=fmtDay(item.created_at)
    const heading=next===day?'':`<div class="album-day">${esc(next)}</div>`
    day=next
    return `${heading}${render(item)}`
  }).join('')
}

async function loadChat(memberId:string){
  const {data,error}=await supabase.from('messages')
    .select('id,sender_id,body,created_at,deleted_at,attachment_path,attachment_type,attachment_name')
    .eq('sender_id',memberId)
    .order('created_at',{ascending:false})
    .limit(CHAT_LIMIT)
  if(error)throw error
  const rows=(data||[]) as ChatRow[]
  await primeMedia(rows.map(row=>row.attachment_path))
  return rows
}

async function loadPresume(memberId:string){
  const {data,error}=await supabase.from('social_posts')
    .select('id,member_id,media_type,media_path,body,prompt_slot,prompt_date,created_at')
    .eq('member_id',memberId)
    .order('created_at',{ascending:false})
    .limit(POST_LIMIT)
  if(error)throw error
  const rows=(data||[]) as PostRow[]
  await primeMedia(rows.map(row=>row.media_path))
  return rows
}

function chatMedia(row:ChatRow){
  if(!row.attachment_path)return''
  const path=row.attachment_path
  const type=row.attachment_type||''
  const src=mediaUrl(path)
  if(type.startsWith('image/'))return src?`<button type="button" class="album-archive-media" data-archive-media="image" data-media-path="${esc(path)}"><img src="${esc(src)}" alt="Foto del chat" loading="lazy" decoding="async"></button>`:'<div class="album-archive-loading">Foto privada</div>'
  if(type.startsWith('video/'))return `<button type="button" class="album-archive-media album-video-card" data-archive-media="video" data-media-path="${esc(path)}"><div><span>▶</span>VIDEO DEL CHAT</div></button>`
  if(type.startsWith('audio/'))return src?`<div class="album-audio"><audio controls preload="none" src="${esc(src)}"></audio></div>`:'<div class="album-archive-loading">Audio privado</div>'
  return''
}

function renderChatRow(row:ChatRow){
  const body=row.deleted_at?'Mensaje eliminado':row.body
  return `<article class="album-chat-item">${chatMedia(row)}<div class="album-chat-copy">${body?`<p>${esc(body)}</p>`:''}<small>${esc(fmtTime(row.created_at))}${row.attachment_name?` · ${esc(row.attachment_name)}`:''}</small></div></article>`
}

function presumeMedia(row:PostRow){
  if(row.media_type==='text')return `<div class="album-presume-text">${esc(row.body||'Momento')}</div>`
  if(!row.media_path)return''
  const path=row.media_path
  const src=mediaUrl(path)
  if(row.media_type==='image')return src?`<button type="button" class="album-archive-media" data-archive-media="image" data-media-path="${esc(path)}"><img src="${esc(src)}" alt="PRESUME" loading="lazy" decoding="async"></button>`:'<div class="album-archive-loading">Foto privada</div>'
  if(row.media_type==='video')return `<button type="button" class="album-archive-media album-video-card" data-archive-media="video" data-media-path="${esc(path)}"><div><span>▶</span>VIDEO PRESUME</div></button>`
  if(row.media_type==='audio')return src?`<div class="album-audio"><audio controls preload="none" src="${esc(src)}"></audio></div>`:'<div class="album-archive-loading">Audio privado</div>'
  return''
}

function renderPresumeRow(row:PostRow){
  const slot=row.prompt_slot==='morning'?'Mañana':row.prompt_slot==='afternoon'?'Tarde':'PRESUME'
  const media=presumeMedia(row)
  return `<article class="album-presume-item">${media}<div class="album-presume-body"><span class="album-presume-slot">${esc(slot)}</span>${row.media_type!=='text'&&row.body?`<p>${esc(row.body)}</p>`:''}<small class="album-presume-meta">${esc(fmtTime(row.created_at))}</small></div></article>`
}

async function openArchiveMedia(path:string,type:'image'|'video'){
  try{
    const src=await signMedia(path)
    if(!src)return
    enterView('media')
    openMediaViewer([{src,type,alt:type==='video'?'Video familiar':'Foto familiar'}])
  }catch(error){console.error('Album archive media failed to open',error)}
}

async function renderArchive(root:HTMLElement,member:Member){
  const panel=root.querySelector<HTMLElement>('[data-album-archive]')
  if(!panel)return
  panel.hidden=false
  panel.innerHTML='<div class="album-archive-loading">Organizando recuerdos…</div>'
  try{
    if(activeSection==='chat'){
      const rows=await loadChat(member.id)
      if(!panel.isConnected||mountedMemberId!==member.id||activeSection!=='chat')return
      panel.innerHTML=`<div class="album-archive-head"><h2>Chat de ${esc(member.name)}</h2><span>${rows.length} guardado${rows.length===1?'':'s'}</span></div>${rows.length?dayBlocks(rows,renderChatRow):'<div class="album-archive-empty"><b>Sin mensajes todavía</b><span>Los mensajes que escriba esta persona aparecerán aquí automáticamente.</span></div>'}`
    }else if(activeSection==='presume'){
      const rows=await loadPresume(member.id)
      if(!panel.isConnected||mountedMemberId!==member.id||activeSection!=='presume')return
      panel.innerHTML=`<div class="album-archive-head"><h2>PRESUME de ${esc(member.name)}</h2><span>${rows.length} momento${rows.length===1?'':'s'}</span></div>${rows.length?dayBlocks(rows,renderPresumeRow):'<div class="album-archive-empty"><b>Sin PRESUME todavía</b><span>Sus próximos momentos quedarán organizados aquí.</span></div>'}`
    }else return
    panel.querySelectorAll<HTMLElement>('[data-archive-media]').forEach(button=>button.addEventListener('click',()=>{
      const path=button.dataset.mediaPath||''
      const type=button.dataset.archiveMedia==='video'?'video':'image'
      if(path)void openArchiveMedia(path,type)
    }))
  }catch(error){
    console.error('Family album archive load failed',error)
    panel.innerHTML='<div class="album-archive-empty"><b>No se pudo cargar esta sección</b><span>Inténtalo de nuevo en un momento.</span></div>'
  }
}

function scheduleRefresh(){
  if(refreshTimer!==null)window.clearTimeout(refreshTimer)
  refreshTimer=window.setTimeout(()=>{
    refreshTimer=null
    const root=currentAlbumRoot()
    if(root&&mountedMemberId&&activeSection!=='photos')void resolveMember(root).then(member=>{if(member)void renderArchive(root,member)})
  },160)
}

function ensureRealtime(){
  if(channel)return
  channel=supabase.channel('familia-noa-album-sections')
    .on('postgres_changes',{event:'*',schema:'public',table:'messages'},scheduleRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'social_posts'},scheduleRefresh)
    .subscribe()
}

async function mount(root:HTMLElement){
  const member=await resolveMember(root)
  if(!member||!root.isConnected)return
  const changed=mountedRoot!==root||mountedMemberId!==member.id
  mountedRoot=root
  mountedMemberId=member.id
  if(changed)activeSection='photos'

  const titleRow=root.querySelector<HTMLElement>('.album-title-row')
  if(!titleRow)return
  let tabs=root.querySelector<HTMLElement>('[data-album-tabs]')
  if(!tabs){
    tabs=document.createElement('div')
    tabs.className='album-section-tabs'
    tabs.dataset.albumTabs='1'
    tabs.innerHTML=`<button type="button" class="album-section-tab active" data-album-section="photos">Fotos</button><button type="button" class="album-section-tab" data-album-section="chat">Chat</button><button type="button" class="album-section-tab" data-album-section="presume">PRESUME</button>`
    titleRow.insertAdjacentElement('afterend',tabs)
    const panel=document.createElement('section')
    panel.className='album-section-panel'
    panel.dataset.albumArchive='1'
    panel.hidden=true
    tabs.insertAdjacentElement('afterend',panel)
    tabs.querySelectorAll<HTMLButtonElement>('[data-album-section]').forEach(button=>button.addEventListener('click',()=>{
      const next=(button.dataset.albumSection||'photos') as Section
      if(next===activeSection)return
      activeSection=next
      resetSectionState(root)
      if(next!=='photos')void renderArchive(root,member)
    }))
  }
  updateTabs(root)
  ensureRealtime()
}

function resetSectionState(root:HTMLElement){
  updateTabs(root)
  const count=root.querySelector<HTMLElement>('.album-count')
  if(count&&activeSection==='photos')count.hidden=false
  else if(count)count.hidden=true
}

function scan(){
  const root=currentAlbumRoot()
  if(!root){mountedRoot=null;mountedMemberId='';activeSection='photos';return}
  if(!root.querySelector('[data-album-tabs]'))void mount(root)
}

injectStyles()
const observer=new MutationObserver(scan)
observer.observe(document.body,{childList:true,subtree:true})
scan()
window.addEventListener('beforeunload',()=>{observer.disconnect();channel?.unsubscribe();if(refreshTimer!==null)window.clearTimeout(refreshTimer)},{once:true})

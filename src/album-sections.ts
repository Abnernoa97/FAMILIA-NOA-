import { supabase } from './supabase'
import { mediaUrl, primeMedia, signMedia } from './core/private-media'
import { openMediaViewer } from './core/media-viewer'
import { enterView } from './core/navigation'

type Section='photos'|'chat'|'presume'
type Member={id:string;name:string}
type ChatRow={
  id:string
  sender_id:string
  created_at:string
  attachment_path:string|null
  attachment_type:string|null
}
type PostRow={
  id:string
  member_id:string
  media_type:'image'
  media_path:string|null
  prompt_slot:'morning'|'afternoon'|null
  created_at:string
}

const CHAT_LIMIT=160
const POST_LIMIT=160
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
  .album-day{margin:12px 2px 4px;color:#969087;font:700 9px system-ui;letter-spacing:.09em;text-transform:uppercase}
  .album-media-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
  .album-media-item{position:relative;display:block;width:100%;aspect-ratio:1;border:0;padding:0;border-radius:12px;overflow:hidden;background:#e9e4dc;cursor:pointer}
  .album-media-item img{display:block;width:100%;height:100%;object-fit:cover}
  .album-media-item.video{background:#171716;color:#fff}
  .album-media-video{position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(145deg,#282826,#111)}
  .album-media-video span{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.94);color:#171716;display:grid;place-items:center;font-size:14px;padding-left:2px}
  .album-media-badge{position:absolute;left:7px;bottom:7px;padding:4px 6px;border-radius:999px;background:rgba(17,17,16,.66);color:#fff;font:700 7px system-ui;letter-spacing:.06em;text-transform:uppercase;backdrop-filter:blur(6px)}
  .album-media-time{position:absolute;right:7px;bottom:7px;padding:4px 6px;border-radius:999px;background:rgba(17,17,16,.66);color:#fff;font:600 7px system-ui;backdrop-filter:blur(6px)}
  .album-archive-loading{padding:34px;text-align:center;color:#908a82;font:11px system-ui}
  @media(max-width:430px){.album-section-tabs{margin-top:-6px}.album-section-tab{height:38px;font-size:10px}.album-media-grid{gap:4px}}
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

function groupedMedia<T extends {created_at:string}>(items:T[],render:(item:T)=>string){
  const groups=new Map<string,T[]>()
  items.forEach(item=>{
    const day=fmtDay(item.created_at)
    const list=groups.get(day)||[]
    list.push(item)
    groups.set(day,list)
  })
  return [...groups.entries()].map(([day,rows])=>`<div class="album-day">${esc(day)}</div><div class="album-media-grid">${rows.map(render).join('')}</div>`).join('')
}

async function loadChat(memberId:string){
  const {data,error}=await supabase.from('messages')
    .select('id,sender_id,created_at,attachment_path,attachment_type')
    .eq('sender_id',memberId)
    .not('attachment_path','is',null)
    .order('created_at',{ascending:false})
    .limit(CHAT_LIMIT)
  if(error)throw error
  const rows=((data||[]) as ChatRow[]).filter(row=>{
    const type=row.attachment_type||''
    return !!row.attachment_path&&(type.startsWith('image/')||type.startsWith('video/'))
  })
  await primeMedia(rows.map(row=>row.attachment_path))
  return rows
}

async function loadPresume(memberId:string){
  const {data,error}=await supabase.from('social_posts')
    .select('id,member_id,media_type,media_path,prompt_slot,created_at')
    .eq('member_id',memberId)
    .eq('media_type','image')
    .not('media_path','is',null)
    .order('created_at',{ascending:false})
    .limit(POST_LIMIT)
  if(error)throw error
  const rows=(data||[]) as PostRow[]
  await primeMedia(rows.map(row=>row.media_path))
  return rows
}

function renderChatMedia(row:ChatRow){
  const path=row.attachment_path||''
  const type=row.attachment_type||''
  if(type.startsWith('image/')){
    const src=mediaUrl(path)
    return src?`<button type="button" class="album-media-item" data-archive-media="image" data-media-path="${esc(path)}" aria-label="Abrir foto del chat"><img src="${esc(src)}" alt="Foto del chat" loading="lazy" decoding="async"><span class="album-media-time">${esc(fmtTime(row.created_at))}</span></button>`:`<div class="album-media-item"><div class="album-archive-loading">Foto privada</div></div>`
  }
  return `<button type="button" class="album-media-item video" data-archive-media="video" data-media-path="${esc(path)}" aria-label="Abrir video del chat"><div class="album-media-video"><span>▶</span></div><span class="album-media-badge">Video</span><span class="album-media-time">${esc(fmtTime(row.created_at))}</span></button>`
}

function renderPresumeMedia(row:PostRow){
  const path=row.media_path||''
  const src=mediaUrl(path)
  const slot=row.prompt_slot==='morning'?'Mañana':row.prompt_slot==='afternoon'?'Tarde':'PRESUME'
  return src?`<button type="button" class="album-media-item" data-archive-media="image" data-media-path="${esc(path)}" aria-label="Abrir foto de PRESUME"><img src="${esc(src)}" alt="PRESUME" loading="lazy" decoding="async"><span class="album-media-badge">${esc(slot)}</span><span class="album-media-time">${esc(fmtTime(row.created_at))}</span></button>`:`<div class="album-media-item"><div class="album-archive-loading">Foto privada</div></div>`
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
      panel.innerHTML=`<div class="album-archive-head"><h2>Chat de ${esc(member.name)}</h2><span>${rows.length} archivo${rows.length===1?'':'s'}</span></div>${rows.length?groupedMedia(rows,renderChatMedia):'<div class="album-archive-empty"><b>Sin fotos o videos todavía</b><span>Las fotos y videos que esta persona envíe al chat aparecerán aquí automáticamente.</span></div>'}`
    }else if(activeSection==='presume'){
      const rows=await loadPresume(member.id)
      if(!panel.isConnected||mountedMemberId!==member.id||activeSection!=='presume')return
      panel.innerHTML=`<div class="album-archive-head"><h2>PRESUME de ${esc(member.name)}</h2><span>${rows.length} foto${rows.length===1?'':'s'}</span></div>${rows.length?groupedMedia(rows,renderPresumeMedia):'<div class="album-archive-empty"><b>Sin fotos de PRESUME todavía</b><span>Las imágenes que esta persona publique en PRESUME quedarán aquí.</span></div>'}`
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
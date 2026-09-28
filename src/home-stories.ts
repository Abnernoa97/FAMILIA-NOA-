import './home-stories.css'
import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { mediaUrl, primeMedia, signMedia, forgetMedia } from './core/private-media'
import { optimizePhoto } from './core/media-pipeline'
import { uploadPrivateMedia } from './core/resumable-storage'

const BUCKET='family-photos'
const STORY_MS=6500
const HISTORY_KEY='familiaNoaStoryView'

type Member={id:string;name:string}
type Profile={member_id:string;avatar_path:string|null}
type Story={id:string;member_id:string;media_path:string;created_at:string;expires_at:string}
type StoryGroup={member:Member;stories:Story[]}

let members:Member[]=[]
let profiles=new Map<string,Profile>()
let stories:Story[]=[]
let channel:ReturnType<typeof supabase.channel>|null=null
let loading=false
let dataReady=false
let refreshTimer:number|null=null
let expiryTimer:number|null=null
let viewer:HTMLElement|null=null
let viewerTimer:number|null=null
let viewerGroups:StoryGroup[]=[]
let viewerGroupIndex=0
let viewerStoryIndex=0
let viewerPaused=false
let viewerDrawToken=0
let picker:HTMLElement|null=null
let preview:HTMLElement|null=null

const esc=(value:string)=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[char]||char))
const identity=()=>getIdentity()
const memberFor=(id:string)=>members.find(member=>member.id===id)||null
const profileFor=(id:string)=>profiles.get(id)||null

function age(value:string){
  const ms=Date.now()-new Date(value).getTime()
  if(!Number.isFinite(ms)||ms<60000)return'ahora'
  const minutes=Math.floor(ms/60000)
  if(minutes<60)return`hace ${minutes} min`
  const hours=Math.floor(minutes/60)
  return`hace ${hours} h`
}

function avatarMarkup(member:Member,cls='family-story-avatar'){
  const url=mediaUrl(profileFor(member.id)?.avatar_path)
  return `<span class="${cls}">${url?`<img src="${esc(url)}" alt="${esc(member.name)}">`:esc(member.name.charAt(0)||'?')}</span>`
}

function storyCoverMarkup(group:StoryGroup){
  const latest=group.stories[group.stories.length-1]
  const url=mediaUrl(latest?.media_path)
  if(!url)return avatarMarkup(group.member)
  return `<span class="family-story-avatar"><img src="${esc(url)}" alt="Historia de ${esc(group.member.name)}" loading="eager" decoding="async"></span>`
}

function activeStories(){
  const now=Date.now()
  return stories.filter(story=>new Date(story.expires_at).getTime()>now)
}

function groups(){
  const active=activeStories()
  const byMember=new Map<string,Story[]>()
  active.forEach(story=>{
    const list=byMember.get(story.member_id)||[]
    list.push(story)
    byMember.set(story.member_id,list)
  })
  byMember.forEach(list=>list.sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()))

  const me=identity()?.memberId||''
  const latest=(id:string)=>{
    const list=byMember.get(id)||[]
    return list.length?new Date(list[list.length-1].created_at).getTime():0
  }

  const ordered=members
    .filter(member=>byMember.has(member.id))
    .sort((a,b)=>{
      if(a.id===me)return-1
      if(b.id===me)return 1
      return latest(b.id)-latest(a.id)
    })

  return ordered.map(member=>({member,stories:byMember.get(member.id)||[]}))
}

function storyTile(group:StoryGroup,own=false){
  const member=group.member
  return `<div class="family-story-item ${own?'family-story-own':''}"><button class="family-story-main has-story" data-home-story-member="${esc(member.id)}" aria-label="Ver historia de ${esc(member.name)}"><span class="family-story-frame"><span class="family-story-inner">${storyCoverMarkup(group)}</span></span></button>${own?'<button class="family-story-plus" data-home-story-create aria-label="Agregar a tu historia">+</button>':''}<span class="family-story-name">${own?'Tu historia':esc(member.name)}</span></div>`
}

function createTile(member:Member){
  return `<div class="family-story-item family-story-own"><button class="family-story-main" data-home-story-create aria-label="Agregar a tu historia"><span class="family-story-frame"><span class="family-story-inner">${avatarMarkup(member)}</span></span></button><button class="family-story-plus" data-home-story-create aria-label="Agregar a tu historia">+</button><span class="family-story-name">Tu historia</span></div>`
}

function renderRail(){
  const shell=document.querySelector<HTMLElement>('.shell')
  const top=shell?.querySelector<HTMLElement>('.top')
  if(!shell||!top)return
  shell.querySelector('.family-story-home')?.remove()
  shell.classList.remove('has-home-stories')

  const me=identity()?.memberId||''
  const mine=memberFor(me)
  if(!mine)return

  const currentGroups=groups()
  const ownGroup=currentGroups.find(group=>group.member.id===me)
  const others=currentGroups.filter(group=>group.member.id!==me)
  const section=document.createElement('section')
  section.className='family-story-home'
  section.setAttribute('aria-label','Historias de la familia')
  section.innerHTML=`<div class="family-story-scroll">${ownGroup?storyTile(ownGroup,true):createTile(mine)}${others.map(group=>storyTile(group)).join('')}</div>`
  top.insertAdjacentElement('afterend',section)
  shell.classList.add('has-home-stories')

  section.querySelectorAll<HTMLElement>('[data-home-story-member]').forEach(button=>{
    button.addEventListener('click',()=>void openViewer(button.dataset.homeStoryMember||''))
  })
  section.querySelectorAll<HTMLElement>('[data-home-story-create]').forEach(button=>{
    button.addEventListener('click',event=>{event.stopPropagation();showPicker()})
  })
}

function clearExpiryTimer(){
  if(expiryTimer!==null){window.clearTimeout(expiryTimer);expiryTimer=null}
}

function scheduleExpiryRefresh(){
  clearExpiryTimer()
  const now=Date.now()
  const next=activeStories().map(story=>new Date(story.expires_at).getTime()).filter(time=>time>now).sort((a,b)=>a-b)[0]
  if(!next)return
  const delay=Math.max(1000,Math.min(next-now+500,2147483000))
  expiryTimer=window.setTimeout(()=>void refreshStories(),delay)
}

async function refreshStories(){
  if(loading)return
  const me=identity()?.memberId
  if(!me)return
  loading=true
  try{
    const now=new Date().toISOString()
    const [membersRes,profilesRes,storiesRes]=await Promise.all([
      supabase.from('family_members').select('id,name').eq('active',true).order('created_at'),
      supabase.from('family_profiles').select('member_id,avatar_path'),
      supabase.from('family_stories').select('id,member_id,media_path,created_at,expires_at').gt('expires_at',now).order('created_at',{ascending:true})
    ])
    if(membersRes.error)throw membersRes.error
    if(profilesRes.error)throw profilesRes.error
    if(storiesRes.error)throw storiesRes.error

    members=(membersRes.data||[]) as Member[]
    profiles=new Map(((profilesRes.data||[]) as Profile[]).map(profile=>[profile.member_id,profile]))
    stories=(storiesRes.data||[]) as Story[]
    dataReady=true

    // Paint the rail as soon as relational data arrives. Previously signed URLs are
    // already restored from the private-media cache, so repeat opens feel immediate.
    renderRail()
    scheduleExpiryRefresh()

    const paths=[
      ...stories.map(story=>story.media_path),
      ...Array.from(profiles.values()).map(profile=>profile.avatar_path)
    ]
    await primeMedia(paths)
    // First-time media may have required a fresh signature; hydrate the covers once.
    renderRail()
    scheduleExpiryRefresh()
  }catch(error){
    console.error('Home stories failed to load',error)
  }finally{
    loading=false
  }
}

function scheduleRefresh(){
  if(refreshTimer!==null)window.clearTimeout(refreshTimer)
  refreshTimer=window.setTimeout(()=>{
    refreshTimer=null
    void refreshStories()
  },80)
}

function startRealtime(){
  if(channel)return
  channel=supabase.channel('familia-home-stories')
    .on('postgres_changes',{event:'*',schema:'public',table:'family_stories'},scheduleRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'family_profiles'},scheduleRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'family_members'},scheduleRefresh)
    .subscribe()
}

function stopRealtime(){
  channel?.unsubscribe()
  channel=null
  clearExpiryTimer()
  if(refreshTimer!==null){window.clearTimeout(refreshTimer);refreshTimer=null}
}

function closePicker(){picker?.remove();picker=null}
function closePreview(){preview?.remove();preview=null}

function showPicker(){
  closePicker()
  const root=document.createElement('div')
  root.className='family-story-picker'
  root.innerHTML=`<div class="family-story-picker-card"><div class="family-story-picker-head"><b>Tu historia</b><button class="family-story-picker-close" aria-label="Cerrar">×</button></div><div class="family-story-source-grid"><button class="family-story-source" data-story-source="camera"><i>◎</i><b>Cámara</b><small>Tómala ahora</small></button><button class="family-story-source" data-story-source="gallery"><i>▧</i><b>Galería</b><small>Elige una foto</small></button></div></div>`
  document.body.appendChild(root)
  picker=root
  root.addEventListener('click',event=>{if(event.target===root)closePicker()})
  root.querySelector('.family-story-picker-close')?.addEventListener('click',closePicker)
  root.querySelector('[data-story-source="camera"]')?.addEventListener('click',()=>pickPhoto('camera'))
  root.querySelector('[data-story-source="gallery"]')?.addEventListener('click',()=>pickPhoto('gallery'))
}

function pickPhoto(source:'camera'|'gallery'){
  closePicker()
  const input=document.createElement('input')
  input.type='file'
  input.accept='image/*'
  input.hidden=true
  if(source==='camera')input.setAttribute('capture','environment')
  document.body.appendChild(input)
  input.addEventListener('change',()=>{
    const file=input.files?.[0]||null
    input.remove()
    if(file)showPreview(file,source)
  },{once:true})
  input.click()
}

function showPreview(file:File,source:'camera'|'gallery'){
  closePreview()
  const objectUrl=URL.createObjectURL(file)
  const root=document.createElement('div')
  root.className='family-story-preview'
  root.innerHTML=`<div class="family-story-preview-media"><img src="${esc(objectUrl)}" alt="Vista previa de tu historia"></div><div class="family-story-preview-actions"><button class="family-story-repick">${source==='camera'?'Repetir':'Elegir otra'}</button><button class="family-story-publish">Publicar historia</button></div>`
  document.body.appendChild(root)
  preview=root
  let cleaned=false
  const cleanup=()=>{
    if(cleaned)return
    cleaned=true
    URL.revokeObjectURL(objectUrl)
    if(preview===root)preview=null
    root.remove()
  }
  root.querySelector<HTMLButtonElement>('.family-story-repick')?.addEventListener('click',()=>{cleanup();pickPhoto(source)})
  root.querySelector<HTMLButtonElement>('.family-story-publish')?.addEventListener('click',async()=>{
    const publish=root.querySelector<HTMLButtonElement>('.family-story-publish')!
    const repick=root.querySelector<HTMLButtonElement>('.family-story-repick')!
    publish.disabled=true
    repick.disabled=true
    publish.textContent='Publicando…'
    try{
      await publishStory(file)
      cleanup()
      await refreshStories()
    }catch(error){
      console.error('Story publish failed',error)
      publish.disabled=false
      repick.disabled=false
      publish.textContent='No se pudo publicar'
    }
  })
}

async function publishStory(file:File){
  const me=identity()?.memberId
  if(!me)throw new Error('Sesión no disponible')
  const prepared=await optimizePhoto(file,1600,.84)
  const path=`social/${me}/stories/${crypto.randomUUID()}.${prepared.ext}`
  await uploadPrivateMedia(path,prepared.blob,{contentType:prepared.type,cacheControl:'31536000'})
  const {error}=await supabase.from('family_stories').insert({
    member_id:me,
    media_path:path,
    expires_at:new Date(Date.now()+24*60*60*1000).toISOString()
  })
  if(error){
    await supabase.storage.from(BUCKET).remove([path])
    forgetMedia(path)
    throw error
  }
  void signMedia(path).catch(()=>undefined)
}

function clearViewerTimer(){
  if(viewerTimer!==null){window.clearTimeout(viewerTimer);viewerTimer=null}
}

function closeViewerDirect(){
  clearViewerTimer()
  viewerDrawToken++
  viewer?.remove()
  viewer=null
  viewerGroups=[]
  viewerGroupIndex=0
  viewerStoryIndex=0
  viewerPaused=false
}

function closeViewer(){
  if(history.state?.[HISTORY_KEY]===1)history.back()
  else closeViewerDirect()
}

function moveViewer(direction:1|-1){
  if(!viewerGroups.length)return
  const group=viewerGroups[viewerGroupIndex]
  const nextStory=viewerStoryIndex+direction
  if(nextStory>=0&&nextStory<group.stories.length){
    viewerStoryIndex=nextStory
    void drawViewer()
    return
  }
  const nextGroup=viewerGroupIndex+direction
  if(nextGroup<0||nextGroup>=viewerGroups.length){
    closeViewer()
    return
  }
  viewerGroupIndex=nextGroup
  viewerStoryIndex=direction===1?0:viewerGroups[nextGroup].stories.length-1
  void drawViewer()
}

function scheduleViewer(){
  clearViewerTimer()
  if(viewerPaused||!viewer)return
  viewerTimer=window.setTimeout(()=>moveViewer(1),STORY_MS)
}

async function drawViewer(){
  if(!viewer)return
  const token=++viewerDrawToken
  clearViewerTimer()
  const group=viewerGroups[viewerGroupIndex]
  const story=group?.stories[viewerStoryIndex]
  if(!group||!story){closeViewer();return}

  viewer.innerHTML=`<div class="family-story-viewer-top"><div class="family-story-progress">${group.stories.map((_,index)=>`<i class="${index<viewerStoryIndex?'seen':index===viewerStoryIndex?'active':''}"></i>`).join('')}</div><div class="family-story-viewer-head">${avatarMarkup(group.member,'family-story-viewer-avatar')}<div class="family-story-viewer-who"><b>${esc(group.member.name)}</b><span>${age(story.created_at)}</span></div><button class="family-story-viewer-close" aria-label="Cerrar">×</button></div></div><div class="family-story-stage"><div class="family-story-loading">Cargando historia…</div><div class="family-story-stage-nav"><button data-story-prev aria-label="Historia anterior"></button><button data-story-next aria-label="Historia siguiente"></button></div></div>`

  viewer.querySelector('.family-story-viewer-close')?.addEventListener('click',closeViewer)
  viewer.querySelector('[data-story-prev]')?.addEventListener('click',event=>{event.stopPropagation();moveViewer(-1)})
  viewer.querySelector('[data-story-next]')?.addEventListener('click',event=>{event.stopPropagation();moveViewer(1)})
  const stage=viewer.querySelector<HTMLElement>('.family-story-stage')!
  stage.addEventListener('pointerdown',event=>{
    if((event.target as Element).closest('button'))return
    viewerPaused=true
    clearViewerTimer()
  })
  const resume=()=>{if(!viewerPaused)return;viewerPaused=false;scheduleViewer()}
  stage.addEventListener('pointerup',resume)
  stage.addEventListener('pointercancel',resume)
  stage.addEventListener('pointerleave',resume)

  let url=mediaUrl(story.media_path)
  if(!url){
    try{url=await signMedia(story.media_path)}catch(error){console.error('Story media signing failed',error)}
  }
  if(!viewer||token!==viewerDrawToken)return
  const loading=stage.querySelector('.family-story-loading')
  if(!url){
    if(loading)loading.textContent='No se pudo abrir esta historia.'
    scheduleViewer()
    return
  }
  const image=document.createElement('img')
  image.src=url
  image.alt=`Historia de ${group.member.name}`
  image.decoding='async'
  image.addEventListener('load',()=>loading?.remove(),{once:true})
  image.addEventListener('error',()=>{if(loading)loading.textContent='No se pudo abrir esta historia.'},{once:true})
  stage.insertBefore(image,stage.querySelector('.family-story-stage-nav'))
  scheduleViewer()
}

async function openViewer(memberId:string){
  viewerGroups=groups()
  const groupIndex=viewerGroups.findIndex(group=>group.member.id===memberId)
  if(groupIndex<0)return
  viewerGroupIndex=groupIndex
  viewerStoryIndex=0
  viewerPaused=false
  closeViewerDirect()
  viewerGroups=groups()
  viewerGroupIndex=viewerGroups.findIndex(group=>group.member.id===memberId)
  if(viewerGroupIndex<0)return

  const root=document.createElement('div')
  root.className='family-story-viewer'
  document.body.appendChild(root)
  viewer=root
  history.pushState({...(history.state||{}),[HISTORY_KEY]:1},'',location.href)
  await drawViewer()
}

window.addEventListener('popstate',()=>{
  if(viewer&&history.state?.[HISTORY_KEY]!==1)closeViewerDirect()
})

function scan(){
  const shell=document.querySelector<HTMLElement>('.shell')
  if(!shell){
    stopRealtime()
    closePicker()
    closePreview()
    if(viewer)closeViewerDirect()
    if(identity()?.memberId&&!dataReady&&!loading)void refreshStories()
    return
  }
  startRealtime()
  if(dataReady){
    if(!shell.querySelector('.family-story-home'))renderRail()
    scheduleExpiryRefresh()
  }else if(!loading){
    void refreshStories()
  }
}

window.addEventListener('familia-noa:identity-changed',()=>{
  dataReady=false
  members=[]
  profiles.clear()
  stories=[]
  scan()
})

const observer=new MutationObserver(scan)
observer.observe(document.body,{childList:true,subtree:true})
scan()
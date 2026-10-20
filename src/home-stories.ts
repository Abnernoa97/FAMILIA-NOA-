import './home-stories.css'
import { PageFlip } from 'page-flip'
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
let viewedStoryIds=new Set<string>()
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
let viewerTurning=false
let viewerMediaReady=false
let viewerStartedAt=0
let viewerRemainingMs=STORY_MS
const wiredStoryRails=new WeakSet<HTMLElement>()
let snapshotStoryAction:{kind:'member'|'create';memberId?:string}|null=null
let picker:HTMLElement|null=null
let preview:HTMLElement|null=null
let actionSheet:HTMLElement|null=null

const esc=(value:string)=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))
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

function groupHasUnseen(group:StoryGroup){
  const me=identity()?.memberId||''
  if(!me||group.member.id===me)return false
  return group.stories.some(story=>!viewedStoryIds.has(story.id))
}

function storyTile(group:StoryGroup,own=false){
  const member=group.member
  const stateClass=own?'own-story':groupHasUnseen(group)?'new-story':'seen-story'
  return `<div class="family-story-item ${own?'family-story-own':''}"><button class="family-story-main has-story ${stateClass}" data-home-story-member="${esc(member.id)}" aria-label="Ver historia de ${esc(member.name)}"><span class="family-story-frame"><span class="family-story-inner">${storyCoverMarkup(group)}</span></span></button>${own?'<button class="family-story-plus" data-home-story-create aria-label="Agregar a tu historia">+</button>':''}<span class="family-story-name">${own?'Tu historia':esc(member.name)}</span></div>`
}

function createTile(member:Member){
  return `<div class="family-story-item family-story-own"><button class="family-story-main" data-home-story-create aria-label="Agregar a tu historia"><span class="family-story-frame"><span class="family-story-inner">${avatarMarkup(member)}</span></span></button><button class="family-story-plus" data-home-story-create aria-label="Agregar a tu historia">+</button><span class="family-story-name">Tu historia</span></div>`
}

function renderRail(){
  const shell=document.querySelector<HTMLElement>('.shell')
  const top=shell?.querySelector<HTMLElement>('.top')
  if(!shell||!top)return
  const me=identity()?.memberId||''
  const mine=memberFor(me)
  if(!mine)return

  const currentGroups=groups()
  const ownGroup=currentGroups.find(group=>group.member.id===me)
  const others=currentGroups.filter(group=>group.member.id!==me)
  const content=`${ownGroup?storyTile(ownGroup,true):createTile(mine)}${others.map(group=>storyTile(group)).join('')}`

  // The former implementation removed and reinserted the entire story rail
  // twice at startup (DB data, then signed media). Besides visibly blinking,
  // this also caused the instant-snapshot observer to repaint a third time.
  // Keep the rail node and geometry stable; update only when content changes.
  let section=shell.querySelector<HTMLElement>('.family-story-home')
  if(!section){
    section=document.createElement('section')
    section.className='family-story-home'
    section.setAttribute('aria-label','Historias de la familia')
    const scroll=document.createElement('div')
    scroll.className='family-story-scroll'
    section.appendChild(scroll)
    top.insertAdjacentElement('afterend',section)
  }
  const scroll=section.querySelector<HTMLElement>('.family-story-scroll')
  if(scroll&&scroll.innerHTML!==content)scroll.innerHTML=content
  if(section.hasAttribute('data-instant-snapshot'))section.removeAttribute('data-instant-snapshot')
  shell.classList.add('has-home-stories')

  // Delegation survives cover hydration and instant-snapshot adoption without
  // stacking a new listener on each database/media refresh.
  // A cached rail is re-created from HTML, so its old dataset attribute does
  // not mean JavaScript listeners survived. Use live DOM identity, not markup.
  if(!wiredStoryRails.has(section)){
    wiredStoryRails.add(section)
    section.addEventListener('click',event=>{
      const target=event.target as Element|null
      const member=target?.closest<HTMLElement>('[data-home-story-member]')
      if(member){void openViewer(member.dataset.homeStoryMember||'');return}
      if(target?.closest('[data-home-story-create]')){
        event.stopPropagation()
        showPicker()
      }
    })
  }
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
    const [membersRes,profilesRes,storiesRes,viewsRes]=await Promise.all([
      supabase.from('family_members').select('id,name').eq('active',true).order('created_at'),
      supabase.from('family_profiles').select('member_id,avatar_path'),
      supabase.from('family_stories').select('id,member_id,media_path,created_at,expires_at').gt('expires_at',now).order('created_at',{ascending:true}),
      supabase.from('family_story_views').select('story_id').eq('viewer_member_id',me)
    ])
    if(membersRes.error)throw membersRes.error
    if(profilesRes.error)throw profilesRes.error
    if(storiesRes.error)throw storiesRes.error
    if(viewsRes.error)throw viewsRes.error

    members=(membersRes.data||[]) as Member[]
    profiles=new Map(((profilesRes.data||[]) as Profile[]).map(profile=>[profile.member_id,profile]))
    stories=(storiesRes.data||[]) as Story[]
    ;((viewsRes.data||[]) as Array<{story_id:string}>).forEach(row=>viewedStoryIds.add(row.story_id))
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
    consumeSnapshotStoryAction()
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
    .on('postgres_changes',{event:'*',schema:'public',table:'family_story_views'},scheduleRefresh)
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
function closeActionSheet(){actionSheet?.remove();actionSheet=null}

function showPicker(){
  closePicker()
  const me=identity()?.memberId||''
  const count=groups().find(group=>group.member.id===me)?.stories.length||0
  const countText=count===0?'Dura 24 horas':`${count} ${count===1?'historia activa':'historias activas'}`
  const root=document.createElement('div')
  root.className='family-story-picker'
  root.innerHTML=`<div class="family-story-picker-card"><div class="family-story-picker-head"><div><b>Tu historia</b><small>${countText}</small></div><button class="family-story-picker-close" aria-label="Cerrar">×</button></div><div class="family-story-source-grid"><button class="family-story-source" data-story-source="camera"><i>◎</i><b>Cámara</b><small>Tómala ahora</small></button><button class="family-story-source" data-story-source="gallery"><i>▧</i><b>Galería</b><small>Elige una foto</small></button></div></div>`
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

async function markViewed(story:Story){
  const me=identity()?.memberId
  if(!me||story.member_id===me||viewedStoryIds.has(story.id))return
  viewedStoryIds.add(story.id)
  renderRail()
  const {error}=await supabase.from('family_story_views').upsert({
    story_id:story.id,
    viewer_member_id:me,
    viewed_at:new Date().toISOString()
  },{onConflict:'story_id,viewer_member_id'})
  if(error)console.warn('Story view could not be saved',error)
}

function clearViewerTimer(){
  if(viewerTimer!==null){window.clearTimeout(viewerTimer);viewerTimer=null}
}
function pauseViewer(){
  if(viewerStartedAt){
    viewerRemainingMs=Math.max(100,viewerRemainingMs-(Date.now()-viewerStartedAt))
    viewerStartedAt=0
  }
  clearViewerTimer()
  viewerPaused=true
  const bar=viewer?.querySelector<HTMLElement>('.family-story-progress i.active span')
  if(bar){
    bar.style.transition='none'
    bar.style.transform=`scaleX(${Math.max(0,Math.min(1,(STORY_MS-viewerRemainingMs)/STORY_MS))})`
  }
}
function resumeViewer(){
  if(!viewerPaused)return
  viewerPaused=false
  scheduleViewer()
}

function closeViewerDirect(){
  viewerTurning=false
  viewerMediaReady=false
  viewerStartedAt=0
  viewerRemainingMs=STORY_MS
  snapshotStoryAction=null
  clearViewerTimer()
  closeActionSheet()
  viewerDrawToken++
  viewer?.remove()
  viewer=null
  viewerGroups=[]
  viewerGroupIndex=0
  viewerStoryIndex=0
  viewerPaused=false
}

function closeViewer(){
  closeActionSheet()
  if(history.state?.[HISTORY_KEY]===1)history.back()
  else closeViewerDirect()
}

// Same physical paper-turn engine and timing family used in HAVANA QUOTES.
// The overlay is purely visual: existing story media, permissions, progress,
// view tracking and navigation continue to use the original viewer controller.
async function animateMagazineTurn(next:Story,direction:1|-1){
  const stage=viewer?.querySelector<HTMLElement>('.family-story-stage')
  const currentImage=stage?.querySelector<HTMLImageElement>('img')
  if(!stage||!currentImage?.src)return
  let nextUrl=mediaUrl(next.media_path)
  if(!nextUrl){
    try{nextUrl=await signMedia(next.media_path)}catch(error){
      console.warn('Could not prepare magazine page',error)
      return
    }
  }
  if(!nextUrl||!viewer||!document.contains(stage))return

  const overlay=document.createElement('div')
  overlay.className='family-story-magazine-overlay'
  const host=document.createElement('div')
  host.className='family-story-magazine-host'
  overlay.appendChild(host)
  const makePage=(url:string)=>{
    const page=document.createElement('div')
    page.className='family-story-magazine-leaf'
    const img=document.createElement('img')
    img.src=url
    img.alt=''
    img.draggable=false
    page.appendChild(img)
    return page
  }
  const oldPage=makePage(currentImage.src)
  const newPage=makePage(nextUrl)
  const pages=direction===1?[oldPage,newPage]:[newPage,oldPage]
  host.append(...pages)
  stage.appendChild(overlay)

  let flip:PageFlip|null=null
  try{
    const width=Math.max(260,Math.round(stage.clientWidth))
    const height=Math.max(360,Math.round(stage.clientHeight))
    flip=new PageFlip(host,{
      width,height,size:'stretch',
      minWidth:width,maxWidth:width,minHeight:height,maxHeight:height,
      drawShadow:true,maxShadowOpacity:.72,flippingTime:920,
      usePortrait:true,autoSize:true,showCover:false,
      mobileScrollSupport:false,swipeDistance:25,
      showPageCorners:true,disableFlipByClick:true
    })
    flip.loadFromHTML(pages)
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    if(direction===-1)flip.turnToPage(1)
    if(direction===1)flip.flipNext('bottom')
    else flip.flipPrev('bottom')
    await new Promise<void>(resolve=>window.setTimeout(resolve,990))
  }catch(error){
    // Never let an animation failure stop a real story from opening.
    console.warn('Magazine turn unavailable, continuing normally',error)
  }finally{
    try{flip?.destroy()}catch{}
    overlay.remove()
  }
}

async function moveViewer(direction:1|-1){
  if(!viewerGroups.length||viewerTurning||!viewer)return
  const currentGroup=viewerGroups[viewerGroupIndex]
  const currentStory=currentGroup?.stories[viewerStoryIndex]
  let nextGroupIndex=viewerGroupIndex
  let nextStoryIndex=viewerStoryIndex+direction
  if(nextStoryIndex<0||nextStoryIndex>=currentGroup.stories.length){
    nextGroupIndex+=direction
    if(nextGroupIndex<0||nextGroupIndex>=viewerGroups.length){
      closeViewer()
      return
    }
    nextStoryIndex=direction===1?0:viewerGroups[nextGroupIndex].stories.length-1
  }
  const next=viewerGroups[nextGroupIndex]?.stories[nextStoryIndex]
  if(!next)return
  const openedViewer=viewer
  viewerTurning=true
  clearViewerTimer()
  viewerStartedAt=0
  try{
    if(currentStory)await animateMagazineTurn(next,direction)
  }finally{
    viewerTurning=false
  }
  if(!viewer||viewer!==openedViewer)return
  viewerGroupIndex=nextGroupIndex
  viewerStoryIndex=nextStoryIndex
  void drawViewer()
}

function scheduleViewer(){
  clearViewerTimer()
  if(viewerPaused||viewerTurning||!viewer||!viewerMediaReady)return
  viewerRemainingMs=Math.max(100,viewerRemainingMs)
  viewerStartedAt=Date.now()
  const bar=viewer.querySelector<HTMLElement>('.family-story-progress i.active span')
  if(bar){
    bar.style.transition='none'
    bar.style.transform=`scaleX(${Math.max(0,Math.min(1,(STORY_MS-viewerRemainingMs)/STORY_MS))})`
    // Ensure the browser sees the starting position before animating.
    void bar.offsetWidth
    bar.style.transition=`transform ${viewerRemainingMs}ms linear`
    bar.style.transform='scaleX(1)'
  }
  viewerTimer=window.setTimeout(()=>{
    viewerStartedAt=0
    void moveViewer(1)
  },viewerRemainingMs)
}

function showOwnStoryActions(story:Story,position:number,total:number){
  closeActionSheet()
  clearViewerTimer()
  pauseViewer()
  const root=document.createElement('div')
  root.className='family-story-actions'
  root.innerHTML=`<div class="family-story-actions-card"><div class="family-story-actions-copy"><b>Tu historia</b><span>${total===1?'1 historia activa':`${position} de ${total} historias activas`}</span></div><button class="family-story-delete" data-story-delete>Eliminar historia</button><button class="family-story-cancel" data-story-cancel>Cancelar</button></div>`
  document.body.appendChild(root)
  actionSheet=root
  const resume=()=>{
    closeActionSheet()
    resumeViewer()
  }
  root.addEventListener('click',event=>{if(event.target===root)resume()})
  root.querySelector('[data-story-cancel]')?.addEventListener('click',resume)
  root.querySelector<HTMLButtonElement>('[data-story-delete]')?.addEventListener('click',async()=>{
    const button=root.querySelector<HTMLButtonElement>('[data-story-delete]')!
    button.disabled=true
    button.textContent='Eliminando…'
    try{
      await deleteOwnStory(story)
    }catch(error){
      console.error('Story delete failed',error)
      button.disabled=false
      button.textContent='No se pudo eliminar'
    }
  })
}

async function deleteOwnStory(story:Story){
  const me=identity()?.memberId
  if(!me||story.member_id!==me)throw new Error('NOT_OWN_STORY')

  const {error}=await supabase.from('family_stories').delete().eq('id',story.id).eq('member_id',me)
  if(error)throw error

  stories=stories.filter(item=>item.id!==story.id)
  viewedStoryIds.delete(story.id)
  forgetMedia(story.media_path)
  closeActionSheet()
  renderRail()
  scheduleExpiryRefresh()

  const {error:storageError}=await supabase.storage.from(BUCKET).remove([story.media_path])
  if(storageError)console.warn('Deleted story left an orphaned media object',storageError)

  if(!viewer)return
  const nextGroups=groups()
  const sameGroupIndex=nextGroups.findIndex(group=>group.member.id===me)
  if(sameGroupIndex<0){
    closeViewer()
    return
  }
  viewerGroups=nextGroups
  viewerGroupIndex=sameGroupIndex
  viewerStoryIndex=Math.min(viewerStoryIndex,viewerGroups[viewerGroupIndex].stories.length-1)
  viewerPaused=false
  await drawViewer()
}

async function drawViewer(){
  if(!viewer)return
  const token=++viewerDrawToken
  clearViewerTimer()
  viewerStartedAt=0
  viewerRemainingMs=STORY_MS
  viewerMediaReady=false
  closeActionSheet()
  const group=viewerGroups[viewerGroupIndex]
  const story=group?.stories[viewerStoryIndex]
  if(!group||!story){closeViewer();return}

  const own=group.member.id===identity()?.memberId
  const ownerActions=own?'<button class="family-story-viewer-more" data-story-more aria-label="Opciones de tu historia">⋯</button>':''
  viewer.innerHTML=`<div class="family-story-viewer-top"><div class="family-story-progress">${group.stories.map((_,index)=>`<i class="${index<viewerStoryIndex?'seen':index===viewerStoryIndex?'active':''}"><span></span></i>`).join('')}</div><div class="family-story-viewer-head">${avatarMarkup(group.member,'family-story-viewer-avatar')}<div class="family-story-viewer-who"><b>${esc(group.member.name)}</b><span>${age(story.created_at)}</span></div>${ownerActions}<button class="family-story-viewer-close" aria-label="Cerrar">×</button></div></div><div class="family-story-stage"><div class="family-story-loading">Cargando historia…</div><div class="family-story-stage-nav"><button data-story-prev aria-label="Historia anterior"></button><button data-story-next aria-label="Historia siguiente"></button></div></div>`

  viewer.querySelector('.family-story-viewer-close')?.addEventListener('click',closeViewer)
  viewer.querySelector('[data-story-more]')?.addEventListener('click',()=>showOwnStoryActions(story,viewerStoryIndex+1,group.stories.length))
  viewer.querySelector('[data-story-prev]')?.addEventListener('click',event=>{event.stopPropagation();moveViewer(-1)})
  viewer.querySelector('[data-story-next]')?.addEventListener('click',event=>{event.stopPropagation();moveViewer(1)})
  const stage=viewer.querySelector<HTMLElement>('.family-story-stage')!
  stage.addEventListener('pointerdown',event=>{
    if((event.target as Element).closest('button'))return
    pauseViewer()
  })
  const resume=()=>resumeViewer()
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
    return
  }
  const image=document.createElement('img')
  image.src=url
  image.alt=`Historia de ${group.member.name}`
  image.decoding='async'
  const ready=()=>{
    if(viewer!==stage.closest('.family-story-viewer')||token!==viewerDrawToken)return
    loading?.remove()
    viewerMediaReady=true
    void markViewed(story)
    scheduleViewer()
  }
  image.addEventListener('load',ready,{once:true})
  image.addEventListener('error',()=>{if(loading)loading.textContent='No se pudo abrir esta historia.'},{once:true})
  stage.insertBefore(image,stage.querySelector('.family-story-stage-nav'))
  if(image.complete&&image.naturalWidth>0)ready()
}

async function openViewer(memberId:string){
  viewerGroups=groups()
  const groupIndex=viewerGroups.findIndex(group=>group.member.id===memberId)
  if(groupIndex<0)return
  const targetGroup=viewerGroups[groupIndex]
  const me=identity()?.memberId||''
  const firstUnseen=targetGroup.member.id===me?-1:targetGroup.stories.findIndex(story=>!viewedStoryIds.has(story.id))
  viewerGroupIndex=groupIndex
  viewerStoryIndex=firstUnseen>=0?firstUnseen:0
  viewerPaused=false
  viewerTurning=false
  viewerMediaReady=false

  const root=document.createElement('div')
  root.className='family-story-viewer'
  document.body.appendChild(root)
  viewer=root
  history.pushState({...(history.state||{}),[HISTORY_KEY]:1},'',location.href)
  await drawViewer()
}

// The instant startup snapshot contains HTML but never the original event
// handlers. Queue a tap until the authoritative, current story list is ready.
function consumeSnapshotStoryAction(){
  if(!snapshotStoryAction||!dataReady||loading)return
  const action=snapshotStoryAction
  snapshotStoryAction=null
  if(action.kind==='create'){showPicker();return}
  if(action.memberId&&!viewer){
    void openViewer(action.memberId).catch(error=>console.warn('Story could not open',error))
  }
}

window.addEventListener('familia-noa:snapshot-story-press',event=>{
  const action=(event as CustomEvent<{kind:'member'|'create';memberId?:string}>).detail
  if(!action||!['member','create'].includes(action.kind))return
  snapshotStoryAction=action
  if(!dataReady){if(!loading)void refreshStories();return}
  consumeSnapshotStoryAction()
})

window.addEventListener('familia-noa:open-story-notification',event=>{
  const memberId=(event as CustomEvent<{memberId?:string}>).detail?.memberId||''
  if(!memberId)return
  void (async()=>{
    if(!dataReady)await refreshStories()
    if(!viewer)await openViewer(memberId)
  })().catch(error=>console.warn('Family story notification navigation unavailable',error))
})
window.addEventListener('popstate',()=>{
  if(viewer&&history.state?.[HISTORY_KEY]!==1)closeViewerDirect()
})

function scan(){
  const shell=document.querySelector<HTMLElement>('.shell')
  if(!shell){
    stopRealtime()
    closePicker()
    closePreview()
    closeActionSheet()
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
  viewedStoryIds.clear()
  scan()
})

const observer=new MutationObserver(scan)
observer.observe(document.body,{childList:true,subtree:true})
scan()

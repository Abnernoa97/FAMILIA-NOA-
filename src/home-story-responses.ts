import './home-story-responses.css'
import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { mediaUrl, signMedia, forgetMedia } from './core/private-media'
import { uploadPrivateMedia } from './core/resumable-storage'

const BUCKET='family-photos'
const MAX_TEXT=280
const MAX_VOICE_MS=30_000
const RESPONSE_PAGE_SIZE=500

type Member={id:string;name:string}
type StoryRef={id:string;media_path:string;expires_at:string}
type StoryResponse={
  id:string
  story_id:string
  member_id:string
  kind:'heart'|'text'|'audio'
  body:string|null
  media_path:string|null
  created_at:string
}

let members=new Map<string,Member>()
let currentStoryId=''
let currentMediaPath=''
let responses:StoryResponse[]=[]
let realtime:ReturnType<typeof supabase.channel>|null=null
let reloadTimer:number|null=null
let scanQueued=false
let resolveToken=0
let pausedByResponses=false
let recorder:MediaRecorder|null=null
let recorderStream:MediaStream|null=null
let recorderChunks:Blob[]=[]
let recorderStartedAt=0
let recorderTimer:number|null=null
let recorderStopTimer:number|null=null
let recordingStoryId=''
let activeAudio:HTMLAudioElement|null=null
let activeAudioButton:HTMLButtonElement|null=null

const esc=(value:string)=>String(value||'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[char]||char))
const me=()=>getIdentity()?.memberId||''
const nameFor=(id:string)=>members.get(id)?.name||'Familia'

function currentViewer(){return document.querySelector<HTMLElement>('.family-story-viewer')}
function currentStage(){return currentViewer()?.querySelector<HTMLElement>('.family-story-stage')||null}

function pauseStory(){
  if(pausedByResponses)return
  const stage=currentStage()
  if(!stage)return
  pausedByResponses=true
  stage.dispatchEvent(new Event('pointerdown',{bubbles:true}))
}

function resumeStory(){
  if(!pausedByResponses||recorder||activeAudio)return
  const stage=currentStage()
  pausedByResponses=false
  stage?.dispatchEvent(new Event('pointerup',{bubbles:true}))
}

function signedPath(src:string){
  if(!src)return''
  try{
    const url=new URL(src,location.href)
    const marker='/storage/v1/object/sign/family-photos/'
    const index=url.pathname.indexOf(marker)
    if(index<0)return''
    return decodeURIComponent(url.pathname.slice(index+marker.length))
  }catch{return''}
}

async function ensureMembers(){
  if(members.size)return
  const {data,error}=await supabase.from('family_members').select('id,name').eq('active',true)
  if(error)throw error
  members=new Map(((data||[]) as Member[]).map(member=>[member.id,member]))
}

async function resolveStory(path:string):Promise<StoryRef|null>{
  const {data,error}=await supabase
    .from('family_stories')
    .select('id,media_path,expires_at')
    .eq('media_path',path)
    .gt('expires_at',new Date().toISOString())
    .maybeSingle()
  if(error)throw error
  return (data||null) as StoryRef|null
}

async function loadResponses(storyId:string){
  const all:StoryResponse[]=[]
  let from=0
  while(true){
    const {data,error}=await supabase
      .from('family_story_responses')
      .select('id,story_id,member_id,kind,body,media_path,created_at')
      .eq('story_id',storyId)
      .order('created_at',{ascending:true})
      .range(from,from+RESPONSE_PAGE_SIZE-1)
    if(error)throw error
    const page=(data||[]) as StoryResponse[]
    all.push(...page)
    if(page.length<RESPONSE_PAGE_SIZE)break
    from+=RESPONSE_PAGE_SIZE
  }
  responses=all
}

function heartSummary(){
  const hearts=responses.filter(item=>item.kind==='heart')
  if(!hearts.length)return''
  const names=hearts.slice(-3).map(item=>nameFor(item.member_id))
  const label=hearts.length===1?`${names[0]} ❤️`:`❤️ ${hearts.length}`
  const title=hearts.map(item=>nameFor(item.member_id)).join(', ')
  return `<div class="story-public-heart-summary" title="${esc(title)}">${esc(label)}</div>`
}

function responseFeed(){
  const visible=responses.filter(item=>item.kind!=='heart')
  const items=visible.map(item=>{
    const name=esc(nameFor(item.member_id))
    if(item.kind==='text')return `<div class="story-public-bubble"><b>${name}</b><span>${esc(item.body||'')}</span></div>`
    return `<button class="story-public-bubble story-public-voice" data-story-public-audio="${esc(item.id)}"><b>${name}</b><span>▶ Nota de voz</span></button>`
  }).join('')
  return `<div class="story-public-feed" data-story-public-feed>${heartSummary()}${items}</div>`
}

function renderLayer(){
  const viewer=currentViewer()
  if(!viewer||!currentStoryId)return
  const old=viewer.querySelector<HTMLElement>('.story-public-layer')
  const oldFeed=old?.querySelector<HTMLElement>('[data-story-public-feed]')||null
  const draft=old?.querySelector<HTMLInputElement>('[data-story-public-input]')?.value||''
  const previousScrollTop=oldFeed?.scrollTop||0
  const wasNearBottom=!oldFeed||(oldFeed.scrollHeight-oldFeed.scrollTop-oldFeed.clientHeight<28)
  const ownHeart=responses.find(item=>item.kind==='heart'&&item.member_id===me())
  const recording=!!recorder&&recordingStoryId===currentStoryId
  const elapsed=recording?Math.min(MAX_VOICE_MS,Date.now()-recorderStartedAt):0
  const seconds=Math.max(0,Math.ceil(elapsed/1000))
  const layer=old||document.createElement('div')
  layer.className='story-public-layer'
  layer.dataset.storyPublicLayer=currentStoryId
  layer.innerHTML=`${responseFeed()}<div class="story-public-composer"><button class="story-public-heart ${ownHeart?'active':''}" data-story-public-heart aria-label="${ownHeart?'Quitar corazón':'Reaccionar con corazón'}">♥</button><div class="story-public-text"><input data-story-public-input maxlength="${MAX_TEXT}" value="${esc(draft)}" placeholder="Responder públicamente…" aria-label="Responder a la historia"><button data-story-public-send aria-label="Enviar respuesta">↑</button></div><button class="story-public-mic ${recording?'recording':''}" data-story-public-mic aria-label="${recording?'Detener grabación':'Responder con voz'}">${recording?`■ ${seconds}s`:'🎙'}</button></div>`
  if(!old)viewer.appendChild(layer)
  bindLayer(layer)
  const feed=layer.querySelector<HTMLElement>('[data-story-public-feed]')
  requestAnimationFrame(()=>{
    if(!feed)return
    if(wasNearBottom)feed.scrollTop=feed.scrollHeight
    else feed.scrollTop=Math.min(previousScrollTop,Math.max(0,feed.scrollHeight-feed.clientHeight))
  })
}

function bindLayer(layer:HTMLElement){
  const input=layer.querySelector<HTMLInputElement>('[data-story-public-input]')
  const send=layer.querySelector<HTMLButtonElement>('[data-story-public-send]')
  const heart=layer.querySelector<HTMLButtonElement>('[data-story-public-heart]')
  const mic=layer.querySelector<HTMLButtonElement>('[data-story-public-mic]')
  const feed=layer.querySelector<HTMLElement>('[data-story-public-feed]')

  input?.addEventListener('focus',pauseStory)
  input?.addEventListener('blur',()=>window.setTimeout(resumeStory,120))
  input?.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey){
      event.preventDefault()
      void sendText(input,send)
    }
  })
  feed?.addEventListener('pointerdown',pauseStory)
  feed?.addEventListener('pointerup',()=>window.setTimeout(resumeStory,100))
  feed?.addEventListener('pointercancel',()=>window.setTimeout(resumeStory,100))
  send?.addEventListener('click',()=>void sendText(input,send))
  heart?.addEventListener('click',()=>void toggleHeart(heart))
  mic?.addEventListener('click',()=>void toggleRecording(mic))
  layer.querySelectorAll<HTMLButtonElement>('[data-story-public-audio]').forEach(button=>{
    button.addEventListener('click',()=>void playVoice(button.dataset.storyPublicAudio||'',button))
  })
}

async function sendText(input:HTMLInputElement|null,button:HTMLButtonElement|null){
  const memberId=me()
  const storyId=currentStoryId
  const body=(input?.value||'').trim().slice(0,MAX_TEXT)
  if(!memberId||!storyId||!body)return
  pauseStory()
  if(button)button.disabled=true
  if(input)input.disabled=true
  try{
    const {error}=await supabase.from('family_story_responses').insert({story_id:storyId,member_id:memberId,kind:'text',body})
    if(error)throw error
    if(input)input.value=''
    await reloadCurrent()
  }catch(error){
    console.error('Public story text response failed',error)
  }finally{
    if(button)button.disabled=false
    if(input){input.disabled=false;input.focus()}
  }
}

async function toggleHeart(button:HTMLButtonElement){
  const memberId=me()
  const storyId=currentStoryId
  if(!memberId||!storyId)return
  pauseStory()
  button.disabled=true
  try{
    const existing=responses.find(item=>item.kind==='heart'&&item.member_id===memberId)
    if(existing){
      const {error}=await supabase.from('family_story_responses').delete().eq('id',existing.id).eq('member_id',memberId)
      if(error)throw error
    }else{
      const {error}=await supabase.from('family_story_responses').insert({story_id:storyId,member_id:memberId,kind:'heart'})
      if(error&&String((error as any)?.code||'')!=='23505')throw error
    }
    await reloadCurrent()
  }catch(error){
    console.error('Public story heart failed',error)
  }finally{
    button.disabled=false
    resumeStory()
  }
}

function recordingMime(){
  if(typeof MediaRecorder==='undefined')return''
  const candidates=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus']
  return candidates.find(type=>MediaRecorder.isTypeSupported?.(type))||''
}

function stopRecorderTimers(){
  if(recorderTimer!==null){window.clearInterval(recorderTimer);recorderTimer=null}
  if(recorderStopTimer!==null){window.clearTimeout(recorderStopTimer);recorderStopTimer=null}
}

function cleanupRecorder(){
  stopRecorderTimers()
  recorderStream?.getTracks().forEach(track=>track.stop())
  recorderStream=null
  recorder=null
  recorderChunks=[]
  recorderStartedAt=0
  recordingStoryId=''
}

async function toggleRecording(button:HTMLButtonElement){
  if(recorder){
    recorder.stop()
    return
  }
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
    button.textContent='Sin micrófono'
    window.setTimeout(()=>renderLayer(),1200)
    return
  }
  const memberId=me()
  const storyId=currentStoryId
  if(!memberId||!storyId)return
  pauseStory()
  button.disabled=true
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true})
    if(currentStoryId!==storyId){stream.getTracks().forEach(track=>track.stop());resumeStory();return}
    const mime=recordingMime()
    const next=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream)
    recorder=next
    recorderStream=stream
    recorderChunks=[]
    recorderStartedAt=Date.now()
    recordingStoryId=storyId
    next.addEventListener('dataavailable',event=>{if(event.data.size)recorderChunks.push(event.data)})
    next.addEventListener('stop',()=>void finishRecording(storyId,mime||next.mimeType))
    next.start(250)
    recorderTimer=window.setInterval(renderLayer,1000)
    recorderStopTimer=window.setTimeout(()=>{if(recorder?.state==='recording')recorder.stop()},MAX_VOICE_MS)
    renderLayer()
  }catch(error){
    console.error('Public story voice recording failed',error)
    cleanupRecorder()
    resumeStory()
    button.textContent='Permiso de micrófono'
    window.setTimeout(()=>renderLayer(),1400)
  }finally{
    button.disabled=false
  }
}

async function finishRecording(storyId:string,mime:string){
  const memberId=me()
  const chunks=[...recorderChunks]
  const duration=Math.max(0,Date.now()-recorderStartedAt)
  const stream=recorderStream
  stopRecorderTimers()
  stream?.getTracks().forEach(track=>track.stop())
  recorder=null
  recorderStream=null
  recorderChunks=[]
  recorderStartedAt=0
  recordingStoryId=''
  renderLayer()
  if(!memberId||currentStoryId!==storyId||!chunks.length||duration<350){resumeStory();return}

  const type=mime||chunks[0]?.type||'audio/webm'
  const blob=new Blob(chunks,{type})
  const ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm'
  const path=`social/${memberId}/stories/responses/${crypto.randomUUID()}.${ext}`
  try{
    await uploadPrivateMedia(path,blob,{contentType:type,cacheControl:'31536000'})
    const {error}=await supabase.from('family_story_responses').insert({story_id:storyId,member_id:memberId,kind:'audio',media_path:path})
    if(error){
      await supabase.storage.from(BUCKET).remove([path])
      forgetMedia(path)
      throw error
    }
    void signMedia(path).catch(()=>undefined)
    await reloadCurrent()
  }catch(error){
    console.error('Public story voice response upload failed',error)
  }finally{
    resumeStory()
  }
}

function stopActiveAudio(){
  if(activeAudio){
    activeAudio.pause()
    activeAudio.src=''
    activeAudio=null
  }
  if(activeAudioButton){
    activeAudioButton.classList.remove('playing')
    const span=activeAudioButton.querySelector('span')
    if(span)span.textContent='▶ Nota de voz'
    activeAudioButton=null
  }
}

async function playVoice(responseId:string,button:HTMLButtonElement){
  const response=responses.find(item=>item.id===responseId&&item.kind==='audio')
  if(!response?.media_path)return
  if(activeAudioButton===button&&activeAudio){stopActiveAudio();resumeStory();return}
  stopActiveAudio()
  pauseStory()
  button.disabled=true
  try{
    let url=mediaUrl(response.media_path)
    if(!url)url=await signMedia(response.media_path)
    if(!url)throw new Error('VOICE_URL_MISSING')
    const audio=new Audio(url)
    activeAudio=audio
    activeAudioButton=button
    button.classList.add('playing')
    const span=button.querySelector('span')
    if(span)span.textContent='❚❚ Nota de voz'
    audio.addEventListener('ended',()=>{stopActiveAudio();resumeStory()},{once:true})
    audio.addEventListener('error',()=>{stopActiveAudio();resumeStory()},{once:true})
    await audio.play()
  }catch(error){
    console.error('Public story voice playback failed',error)
    stopActiveAudio()
    resumeStory()
  }finally{button.disabled=false}
}

async function reloadCurrent(){
  const storyId=currentStoryId
  if(!storyId)return
  try{
    await ensureMembers()
    await loadResponses(storyId)
    if(currentStoryId===storyId)renderLayer()
  }catch(error){console.error('Public story responses failed to load',error)}
}

function scheduleReload(){
  if(reloadTimer!==null)window.clearTimeout(reloadTimer)
  reloadTimer=window.setTimeout(()=>{reloadTimer=null;void reloadCurrent()},60)
}

function startRealtime(){
  if(realtime)return
  realtime=supabase.channel('familia-story-public-responses')
    .on('postgres_changes',{event:'*',schema:'public',table:'family_story_responses'},payload=>{
      const row=((payload.new&&Object.keys(payload.new).length)?payload.new:payload.old) as any
      if(row?.story_id===currentStoryId)scheduleReload()
    })
    .subscribe()
}

function resetCurrent(){
  resolveToken++
  currentStoryId=''
  currentMediaPath=''
  responses=[]
  stopActiveAudio()
  if(recorder?.state==='recording'){
    try{recorder.stop()}catch{}
  }
  currentViewer()?.querySelector('.story-public-layer')?.remove()
  pausedByResponses=false
}

async function resolveViewerStory(path:string){
  const token=++resolveToken
  try{
    await ensureMembers()
    const story=await resolveStory(path)
    if(token!==resolveToken||!story)return
    if(currentMediaPath!==path){stopActiveAudio()}
    currentMediaPath=path
    currentStoryId=story.id
    await loadResponses(story.id)
    if(token!==resolveToken||currentStoryId!==story.id)return
    renderLayer()
  }catch(error){console.error('Could not resolve current story for responses',error)}
}

function scan(){
  const viewer=currentViewer()
  if(!viewer){
    if(currentStoryId||currentMediaPath)resetCurrent()
    return
  }
  const image=viewer.querySelector<HTMLImageElement>('.family-story-stage > img')
  const path=signedPath(image?.src||'')
  if(!path)return
  if(path===currentMediaPath&&viewer.querySelector('.story-public-layer'))return
  void resolveViewerStory(path)
}

function queueScan(){
  if(scanQueued)return
  scanQueued=true
  queueMicrotask(()=>{scanQueued=false;scan()})
}

window.addEventListener('familia-noa:identity-changed',()=>{
  members.clear()
  resetCurrent()
  queueScan()
})
window.addEventListener('beforeunload',()=>{
  stopActiveAudio()
  if(recorder?.state==='recording'){try{recorder.stop()}catch{}}
  realtime?.unsubscribe()
},{once:true})

const observer=new MutationObserver(queueScan)
observer.observe(document.body,{childList:true,subtree:true})
startRealtime()
queueScan()

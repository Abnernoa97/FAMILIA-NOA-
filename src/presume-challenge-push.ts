import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { forgetMedia, signMedia } from './core/private-media'
import { optimizePhoto, prepareVideo, prepareAudio, CHAT_VIDEO_MAX_BYTES, CHAT_AUDIO_MAX_BYTES, mediaLimitMb } from './core/media-pipeline'
import { uploadPrivateMedia } from './core/resumable-storage'

const BUCKET='family-photos'
const VAPID_PUBLIC_KEY='BETJT7Qq8P4dQkWe2_ciubkX_MU1dzg747gfYh2EjrAKGROXQnWFRg1gehFf8YubuzyEzIg-iMGhBgEWOjAYL8c'
const PUSH_KEY='familia-noa-presume-web-push'
const LEGACY_REMINDER_KEY='familia-noa-presume-reminders'

type CaptureMode='challenge'|'free'
type Slot='morning'|'afternoon'

let pendingCapture:CaptureMode='free'
let directOpening=false

const localDateKey=(date=new Date())=>{
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0')
  return `${y}-${m}-${d}`
}
const slotNow=():Slot=>new Date().getHours()<14?'morning':'afternoon'

function injectStyles(){
  if(document.querySelector('#presume-challenge-push-css'))return
  const style=document.createElement('style')
  style.id='presume-challenge-push-css'
  style.textContent=`
  .pres-live-camera{position:fixed;inset:0;z-index:1900;background:#050505;color:#fff;display:grid;grid-template-rows:auto 1fr auto;padding:max(12px,env(safe-area-inset-top)) 12px max(18px,env(safe-area-inset-bottom));box-sizing:border-box}
  .pres-live-camera-head{display:flex;justify-content:flex-end}.pres-live-camera-close{width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.13);color:#fff;font-size:24px}
  .pres-live-camera-stage{min-height:0;display:grid;place-items:center;overflow:hidden;border-radius:24px;background:#111}.pres-live-camera-stage video{width:100%;height:100%;object-fit:cover}
  .pres-live-camera-actions{display:grid;place-items:center;padding-top:16px}.pres-live-shutter{width:72px;height:72px;border-radius:50%;border:5px solid #fff;background:transparent;box-shadow:inset 0 0 0 4px #050505}
  `
  document.head.appendChild(style)
}

function base64UrlToBytes(value:string){
  let s=value.replace(/-/g,'+').replace(/_/g,'/')
  while(s.length%4)s+='='
  const raw=atob(s),out=new Uint8Array(raw.length)
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i)
  return out
}

function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)}
function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||(window.navigator as any).standalone===true}
function hasPush(){return 'serviceWorker'in navigator&&'Notification'in window&&'PushManager'in window}

async function ensurePushSubscription(interactive:boolean){
  if(!hasPush())return false
  if(isIOS()&&!isStandalone())return false
  let permission=Notification.permission
  if(permission==='default'&&interactive)permission=await Notification.requestPermission()
  if(permission!=='granted'){
    localStorage.removeItem(PUSH_KEY)
    syncReminderUi()
    return false
  }
  const registration=await navigator.serviceWorker.ready
  let subscription=await registration.pushManager.getSubscription()
  if(!subscription){
    subscription=await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:base64UrlToBytes(VAPID_PUBLIC_KEY)
    })
  }
  const json=subscription.toJSON()
  const endpoint=String(json.endpoint||'')
  const p256dh=String(json.keys?.p256dh||'')
  const auth=String(json.keys?.auth||'')
  if(!endpoint||!p256dh||!auth)throw new Error('PUSH_SUBSCRIPTION_INCOMPLETE')
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Mexico_City'
  const {error}=await supabase.rpc('register_family_push_subscription',{
    p_endpoint:endpoint,
    p_p256dh:p256dh,
    p_auth:auth,
    p_timezone:timezone
  })
  if(error)throw error
  localStorage.setItem(PUSH_KEY,'1')
  syncReminderUi()
  return true
}

function syncReminderUi(){
  const enabled=localStorage.getItem(PUSH_KEY)==='1'&&typeof Notification!=='undefined'&&Notification.permission==='granted'
  const label=enabled?'Recordatorios activados':'Activar recordatorios'
  const state=enabled?'1':'0'
  document.querySelectorAll<HTMLButtonElement>('.presume-screen [data-reminders]').forEach(button=>{
    if(button.textContent!==label)button.textContent=label
    if(button.dataset.realPush!==state)button.dataset.realPush=state
  })
}

async function challengeCompleted(slot:Slot){
  const me=getIdentity()?.memberId
  if(!me)return false
  const {data,error}=await supabase.from('social_posts')
    .select('id')
    .eq('member_id',me)
    .eq('is_prompt_response',true)
    .eq('prompt_date',localDateKey())
    .eq('prompt_slot',slot)
    .limit(1)
  if(error)return false
  return !!data?.length
}

async function publishMedia(file:File,type:'image'|'video',mode:CaptureMode){
  const me=getIdentity()?.memberId
  if(!me)throw new Error('Sesión no disponible')
  if(mode==='challenge'&&type!=='image')throw new Error('El reto PRESUME requiere una foto')

  let blob:Blob,contentType:string,ext:string
  if(type==='image'){
    const prepared=await optimizePhoto(file,1600,.82)
    blob=prepared.blob;contentType=prepared.type;ext=prepared.ext
  }else{
    if(file.size>CHAT_VIDEO_MAX_BYTES)throw new Error(`Máximo ${mediaLimitMb(CHAT_VIDEO_MAX_BYTES)} MB`)
    const prepared=prepareVideo(file)
    blob=prepared.blob;contentType=prepared.type;ext=prepared.ext
  }

  const path=`social/${me}/posts/${crypto.randomUUID()}.${ext}`
  await uploadPrivateMedia(path,blob,{contentType,cacheControl:'31536000'})
  const isChallenge=mode==='challenge'
  const {error}=await supabase.from('social_posts').insert({
    member_id:me,
    media_type:type,
    media_path:path,
    body:'',
    is_prompt_response:isChallenge,
    prompt_slot:isChallenge?slotNow():null,
    prompt_date:isChallenge?localDateKey():null,
    expires_at:new Date(Date.now()+24*60*60*1000).toISOString()
  })
  if(error){
    await supabase.storage.from(BUCKET).remove([path])
    forgetMedia(path)
    if(error.code==='23505'&&isChallenge)throw new Error('Ya compartiste este momento')
    throw error
  }
  await signMedia(path)
}

function showPublishSheet(file:File,type:'image'|'video',mode:CaptureMode){
  const url=URL.createObjectURL(file),modal=document.createElement('div')
  modal.className='pres-modal'
  modal.innerHTML=`<div class="pres-sheet"><div class="pres-sheet-head"><b>${mode==='challenge'?'Tu PRESUME':'¿Lo compartimos?'}</b><button class="pres-sheet-close" aria-label="Cerrar">×</button></div><div class="pres-preview">${type==='image'?`<img src="${url}" alt="Vista previa">`:`<video src="${url}" controls playsinline></video>`}</div><div class="pres-preview-actions"><button class="pres-retake">Repetir</button><button class="pres-publish">Publicar</button></div></div>`
  document.body.appendChild(modal)
  let cleaned=false
  const cleanup=()=>{if(cleaned)return;cleaned=true;URL.revokeObjectURL(url);modal.remove()}
  modal.querySelector('.pres-sheet-close')?.addEventListener('click',cleanup)
  modal.querySelector<HTMLButtonElement>('.pres-retake')?.addEventListener('click',()=>{
    cleanup();pendingCapture=mode
    const input=document.querySelector<HTMLInputElement>(type==='image'?'.presume-screen [data-camera-input]':'.presume-screen [data-video-input]')
    input?.click()
  })
  modal.querySelector<HTMLButtonElement>('.pres-publish')?.addEventListener('click',async()=>{
    const publish=modal.querySelector<HTMLButtonElement>('.pres-publish')!,retake=modal.querySelector<HTMLButtonElement>('.pres-retake')!
    publish.disabled=true;retake.disabled=true;publish.textContent='Publicando…'
    try{await publishMedia(file,type,mode);cleanup()}
    catch(error){publish.disabled=false;retake.disabled=false;publish.textContent=error instanceof Error?error.message:'No se pudo publicar'}
  })
}

async function publishText(){
  const modal=document.createElement('div');modal.className='pres-modal'
  modal.innerHTML='<div class="pres-sheet"><div class="pres-sheet-head"><b>Di algo ahora</b><button class="pres-sheet-close">×</button></div><textarea maxlength="500" style="min-height:180px" placeholder="¿Qué estás pensando? ¿Dónde estás? ¿Qué te hizo reír?"></textarea><button class="pres-publish" style="width:100%;margin-top:9px">Compartir</button></div>'
  document.body.appendChild(modal)
  modal.querySelector('.pres-sheet-close')?.addEventListener('click',()=>modal.remove())
  modal.querySelector<HTMLButtonElement>('.pres-publish')?.addEventListener('click',async()=>{
    const button=modal.querySelector<HTMLButtonElement>('.pres-publish')!,body=modal.querySelector<HTMLTextAreaElement>('textarea')!.value.trim()
    if(!body)return
    button.disabled=true;button.textContent='Compartiendo…'
    const me=getIdentity()?.memberId
    if(!me){button.disabled=false;button.textContent='No se pudo compartir';return}
    const {error}=await supabase.from('social_posts').insert({member_id:me,media_type:'text',body:body.slice(0,500),is_prompt_response:false,prompt_slot:null,prompt_date:null,expires_at:new Date(Date.now()+24*60*60*1000).toISOString()})
    if(error){button.disabled=false;button.textContent='No se pudo compartir';return}
    modal.remove()
  })
}

async function publishVoice(){
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return
  const modal=document.createElement('div');modal.className='pres-modal'
  modal.innerHTML='<div class="pres-sheet"><div class="pres-sheet-head"><b>Nota de voz</b><button class="pres-sheet-close">×</button></div><div class="pres-record recording"><div class="pres-record-pulse">🎙</div><p>Grabando… toca “Terminar” cuando estés listo.</p><button class="pres-publish" style="width:100%;margin-top:9px">Terminar y compartir</button></div></div>'
  document.body.appendChild(modal)
  let stream:MediaStream|null=null,recorder:MediaRecorder|null=null,chunks:BlobPart[]=[]
  const stopAll=()=>stream?.getTracks().forEach(track=>track.stop())
  const close=()=>{if(recorder?.state==='recording')recorder.stop();stopAll();modal.remove()}
  modal.querySelector('.pres-sheet-close')?.addEventListener('click',close)
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true})
    recorder=new MediaRecorder(stream)
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
    recorder.start()
    modal.querySelector<HTMLButtonElement>('.pres-publish')?.addEventListener('click',()=>{if(recorder?.state==='recording')recorder.stop()})
    recorder.onstop=async()=>{
      stopAll();if(!modal.isConnected)return
      const blob=new Blob(chunks,{type:recorder?.mimeType||'audio/webm'})
      if(blob.size>CHAT_AUDIO_MAX_BYTES){modal.querySelector('.pres-record p')!.textContent=`La nota supera ${mediaLimitMb(CHAT_AUDIO_MAX_BYTES)} MB.`;return}
      const button=modal.querySelector<HTMLButtonElement>('.pres-publish')!;button.disabled=true;button.textContent='Compartiendo…'
      let path=''
      try{
        const me=getIdentity()?.memberId;if(!me)throw new Error('Sesión no disponible')
        const file=new File([blob],'presume-voz',{type:blob.type||'audio/webm'}),prepared=prepareAudio(file)
        path=`social/${me}/posts/${crypto.randomUUID()}.${prepared.ext}`
        await uploadPrivateMedia(path,prepared.blob,{contentType:prepared.type,cacheControl:'31536000'})
        const {error}=await supabase.from('social_posts').insert({member_id:me,media_type:'audio',media_path:path,body:'',is_prompt_response:false,prompt_slot:null,prompt_date:null,expires_at:new Date(Date.now()+24*60*60*1000).toISOString()})
        if(error)throw error
        await signMedia(path);modal.remove()
      }catch(error){if(path){await supabase.storage.from(BUCKET).remove([path]);forgetMedia(path)};button.disabled=false;button.textContent='No se pudo compartir'}
    }
  }catch{stopAll();modal.querySelector('.pres-record p')!.textContent='No se pudo acceder al micrófono.'}
}

function waitForPresume(timeout=5000){
  return new Promise<HTMLElement|null>(resolve=>{
    const found=document.querySelector<HTMLElement>('.presume-screen');if(found){resolve(found);return}
    const started=Date.now(),observer=new MutationObserver(()=>{
      const root=document.querySelector<HTMLElement>('.presume-screen')
      if(root){observer.disconnect();resolve(root)}else if(Date.now()-started>timeout){observer.disconnect();resolve(null)}
    })
    observer.observe(document.body,{childList:true,subtree:true})
    window.setTimeout(()=>{observer.disconnect();resolve(document.querySelector<HTMLElement>('.presume-screen'))},timeout)
  })
}

async function openLiveChallengeCamera(){
  if(directOpening)return
  directOpening=true
  document.dispatchEvent(new CustomEvent('presume:capture-start'))
  let stream:MediaStream|null=null
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false})
    const modal=document.createElement('div');modal.className='pres-live-camera'
    modal.innerHTML='<div class="pres-live-camera-head"><button class="pres-live-camera-close" aria-label="Cerrar">×</button></div><div class="pres-live-camera-stage"><video autoplay muted playsinline></video></div><div class="pres-live-camera-actions"><button class="pres-live-shutter" aria-label="Tomar foto"></button></div>'
    document.body.appendChild(modal)
    const video=modal.querySelector<HTMLVideoElement>('video')!;video.srcObject=stream
    await video.play().catch(()=>{})
    const finish=()=>{stream?.getTracks().forEach(track=>track.stop());stream=null;modal.remove();directOpening=false;document.dispatchEvent(new CustomEvent('presume:capture-end'))}
    modal.querySelector('.pres-live-camera-close')?.addEventListener('click',finish)
    modal.querySelector('.pres-live-shutter')?.addEventListener('click',()=>{
      if(!video.videoWidth||!video.videoHeight)return
      const scale=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas')
      canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale))
      const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return
      ctx.drawImage(video,0,0,canvas.width,canvas.height)
      canvas.toBlob(blob=>{
        if(!blob)return
        const file=new File([blob],`presume-${Date.now()}.jpg`,{type:'image/jpeg'})
        stream?.getTracks().forEach(track=>track.stop());stream=null;modal.remove();directOpening=false
        showPublishSheet(file,'image','challenge')
        document.dispatchEvent(new CustomEvent('presume:capture-end'))
      },'image/jpeg',.92)
    })
  }catch{stream?.getTracks().forEach(track=>track.stop());directOpening=false;document.dispatchEvent(new CustomEvent('presume:capture-end'))}
}

async function openFromPush(slot:Slot){
  document.querySelector<HTMLButtonElement>('#ok')?.click()
  const root=await waitForPresume();if(!root)return
  if(await challengeCompleted(slot))return
  await openLiveChallengeCamera()
}

function cleanPushQuery(){
  const url=new URL(location.href)
  const value=url.searchParams.get('presume')
  const slot=(url.searchParams.get('slot')==='afternoon'?'afternoon':'morning') as Slot
  if(value!=='camera')return
  url.searchParams.delete('presume');url.searchParams.delete('slot')
  history.replaceState(history.state,'',url.pathname+url.search+url.hash)
  void openFromPush(slot)
}

function captureClick(event:Event){
  const target=event.target as Element|null
  if(!target)return
  const reminder=target.closest<HTMLButtonElement>('.presume-screen [data-reminders]')
  if(reminder){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void ensurePushSubscription(true).catch(()=>syncReminderUi());return}
  const text=target.closest('.presume-screen [data-text]')
  if(text){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void publishText();return}
  const voice=target.closest('.presume-screen [data-voice]')
  if(voice){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();void publishVoice();return}
  const video=target.closest('.presume-screen [data-video]')
  if(video){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();pendingCapture='free';document.querySelector<HTMLInputElement>('.presume-screen [data-video-input]')?.click();return}
  const camera=target.closest('.presume-screen [data-camera]')
  if(camera){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();pendingCapture=camera.classList.contains('pres-main')?'challenge':'free';document.querySelector<HTMLInputElement>('.presume-screen [data-camera-input]')?.click()}
}

function captureChange(event:Event){
  const input=event.target as HTMLInputElement|null
  if(!input?.matches('.presume-screen [data-camera-input],.presume-screen [data-video-input]'))return
  event.stopPropagation();event.stopImmediatePropagation()
  const file=input.files?.[0];const type=input.matches('[data-video-input]')?'video':'image';input.value=''
  const mode=type==='image'?pendingCapture:'free';pendingCapture='free'
  if(file)showPublishSheet(file,type,mode)
}

injectStyles()
try{localStorage.removeItem(LEGACY_REMINDER_KEY)}catch{}
document.addEventListener('click',captureClick,true)
document.addEventListener('change',captureChange,true)

const observer=new MutationObserver(syncReminderUi)
observer.observe(document.body,{childList:true,subtree:true})

if('serviceWorker'in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type!=='PRESUME_OPEN_CAMERA')return
    const slot=(event.data?.slot==='afternoon'?'afternoon':'morning') as Slot
    void openFromPush(slot)
  })
}

document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Notification.permission==='granted')void ensurePushSubscription(false).catch(()=>{})})
window.addEventListener('online',()=>{if(typeof Notification!=='undefined'&&Notification.permission==='granted')void ensurePushSubscription(false).catch(()=>{})})

syncReminderUi()
if(typeof Notification!=='undefined'&&Notification.permission==='granted')void ensurePushSubscription(false).catch(()=>{})
window.setTimeout(cleanPushQuery,0)

window.addEventListener('beforeunload',()=>observer.disconnect(),{once:true})

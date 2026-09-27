import { supabase } from './supabase'
import { getIdentity } from './core/identity'

const VAPID_PUBLIC_KEY='BETJT7Qq8P4dQkWe2_ciubkX_MU1dzg747gfYh2EjrAKGROXQnWFRg1gehFf8YubuzyEzIg-iMGhBgEWOjAYL8c'
const PUSH_KEY='familia-noa-presume-web-push'
const LEGACY_REMINDER_KEY='familia-noa-presume-reminders'

type Slot='morning'|'afternoon'

const localDateKey=(date=new Date())=>{
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0')
  return `${y}-${m}-${d}`
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

function syncReminderUi(){
  const enabled=localStorage.getItem(PUSH_KEY)==='1'&&typeof Notification!=='undefined'&&Notification.permission==='granted'
  const label=enabled?'Recordatorios activados':'Activar recordatorios'
  const state=enabled?'1':'0'
  document.querySelectorAll<HTMLButtonElement>('.presume-screen [data-reminders]').forEach(button=>{
    if(button.textContent!==label)button.textContent=label
    if(button.dataset.realPush!==state)button.dataset.realPush=state
  })
}

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

function waitForPresume(timeout=5000){
  return new Promise<HTMLElement|null>(resolve=>{
    const found=document.querySelector<HTMLElement>('.presume-screen')
    if(found){resolve(found);return}
    const started=Date.now()
    const observer=new MutationObserver(()=>{
      const root=document.querySelector<HTMLElement>('.presume-screen')
      if(root){observer.disconnect();resolve(root)}
      else if(Date.now()-started>timeout){observer.disconnect();resolve(null)}
    })
    observer.observe(document.body,{childList:true,subtree:true})
    window.setTimeout(()=>{observer.disconnect();resolve(document.querySelector<HTMLElement>('.presume-screen'))},timeout)
  })
}

async function openFromPush(slot:Slot){
  if(!document.querySelector('.presume-screen'))document.querySelector<HTMLButtonElement>('#ok')?.click()
  const root=await waitForPresume()
  if(!root||await challengeCompleted(slot))return
  document.dispatchEvent(new CustomEvent('presume:capture-start'))
  document.dispatchEvent(new CustomEvent('presume:open-challenge-camera',{detail:{slot}}))
}

function cleanPushQuery(){
  const url=new URL(location.href)
  if(url.searchParams.get('presume')!=='camera')return
  const slot=(url.searchParams.get('slot')==='afternoon'?'afternoon':'morning') as Slot
  url.searchParams.delete('presume')
  url.searchParams.delete('slot')
  history.replaceState(history.state,'',url.pathname+url.search+url.hash)
  void openFromPush(slot)
}

function onReminderClick(event:Event){
  const target=event.target as Element|null
  const reminder=target?.closest<HTMLButtonElement>('.presume-screen [data-reminders]')
  if(!reminder)return
  event.preventDefault()
  event.stopPropagation()
  void ensurePushSubscription(true).catch(error=>{
    console.error('PRESUME push subscription failed',error)
    syncReminderUi()
  })
}

try{localStorage.removeItem(LEGACY_REMINDER_KEY)}catch{}
document.addEventListener('click',onReminderClick,true)
document.addEventListener('presume:rendered',syncReminderUi)

if('serviceWorker'in navigator){
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type!=='PRESUME_OPEN_CAMERA')return
    const slot=(event.data?.slot==='afternoon'?'afternoon':'morning') as Slot
    void openFromPush(slot)
  })
}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&typeof Notification!=='undefined'&&Notification.permission==='granted')void ensurePushSubscription(false).catch(()=>{})
})
window.addEventListener('online',()=>{
  if(typeof Notification!=='undefined'&&Notification.permission==='granted')void ensurePushSubscription(false).catch(()=>{})
})

syncReminderUi()
if(typeof Notification!=='undefined'&&Notification.permission==='granted')void ensurePushSubscription(false).catch(()=>{})
window.setTimeout(cleanPushQuery,0)

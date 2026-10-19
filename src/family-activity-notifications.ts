import { supabase } from './supabase'
import { getMemberId, onIdentityChange } from './core/identity'

type FamilyActivity={
  id:number
  member_id:string
  member_name:string
  kind:'online'|'location_sharing'
  created_at:string
}

let channel:ReturnType<typeof supabase.channel>|null=null
let activeMember=''
let lastToast:HTMLElement|null=null
let dismissTimer:number|null=null
const seen=new Set<number>()
const startedAt=Date.now()

function notificationText(row:FamilyActivity){
  return row.kind==='location_sharing'
    ? `${row.member_name} está compartiendo su ubicación`
    : `${row.member_name} se conectó a FAMILIA NOA`
}

function showActivity(row:FamilyActivity){
  if(document.hidden)return // Android native owns background system alerts.
  lastToast?.remove()
  if(dismissTimer!==null)window.clearTimeout(dismissTimer)
  const toast=document.createElement('div')
  toast.className='family-activity-toast'
  toast.setAttribute('role','status')
  toast.setAttribute('aria-live','polite')
  toast.innerHTML=`<span class="family-activity-dot" aria-hidden="true">⌖</span><span class="family-activity-text"></span><button type="button" aria-label="Cerrar aviso">×</button>`
  toast.querySelector<HTMLElement>('.family-activity-text')!.textContent=notificationText(row)
  toast.querySelector('button')?.addEventListener('click',()=>toast.remove())
  toast.addEventListener('click',event=>{
    if((event.target as Element).closest('button'))return
    window.dispatchEvent(new CustomEvent('familia-noa:open-location',{detail:{memberId:row.member_id}}))
    toast.remove()
  })
  document.body.appendChild(toast)
  lastToast=toast
  dismissTimer=window.setTimeout(()=>{toast.remove();if(lastToast===toast)lastToast=null},5500)
}

function handleEvent(value:unknown){
  const row=value as FamilyActivity|undefined
  if(!row||!Number.isSafeInteger(row.id)||seen.has(row.id))return
  if(row.member_id===getMemberId())return
  if(row.kind!=='online'&&row.kind!=='location_sharing')return
  const createdAt=Date.parse(row.created_at)
  if(!Number.isFinite(createdAt)||createdAt<startedAt-15000)return
  seen.add(row.id)
  if(seen.size>100)seen.delete(seen.values().next().value!)
  showActivity(row)
}

function stop(){
  if(channel){void supabase.removeChannel(channel);channel=null}
  activeMember=''
}

function connect(){
  const memberId=getMemberId()
  if(!memberId){stop();return}
  if(memberId===activeMember&&channel)return
  stop()
  activeMember=memberId
  const next=supabase.channel(`family-activity-${memberId}-${Date.now()}`)
  channel=next
  next.on('postgres_changes',{event:'INSERT',schema:'public',table:'family_activity_events'},payload=>{
    handleEvent(payload.new)
  }).subscribe(status=>{
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
      if(channel!==next)return
      stop()
      window.setTimeout(connect,3000)
    }
  })
}

function addStyles(){
  if(document.getElementById('family-activity-toast-css'))return
  const el=document.createElement('style')
  el.id='family-activity-toast-css'
  el.textContent=`
    .family-activity-toast{position:fixed;left:50%;top:max(18px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483000;display:flex;gap:10px;align-items:center;box-sizing:border-box;width:min(calc(100vw - 28px),440px);min-height:60px;padding:12px 13px;border-radius:19px;background:rgba(251,249,242,.98);color:#252620;border:1px solid #dedbd2;box-shadow:0 14px 40px #0003;font:650 13px/1.35 system-ui,sans-serif}
    .family-activity-dot{display:grid;place-items:center;width:37px;height:37px;flex:0 0 37px;background:#e2eee6;border-radius:50%;font-size:21px;color:#316749}
    .family-activity-text{flex:1;min-width:0}.family-activity-toast button{width:30px;height:30px;flex:0 0 30px;border-radius:50%;border:0;background:#eeeae2;color:#58574f;font-size:19px}
  `
  document.head.appendChild(el)
}

addStyles()
const unwatch=onIdentityChange(()=>connect())
supabase.auth.onAuthStateChange(()=>window.setTimeout(connect,0))
window.addEventListener('online',connect)
window.addEventListener('beforeunload',()=>{unwatch();stop()},{once:true})
connect()

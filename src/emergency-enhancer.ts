import { supabase } from './supabase'
import { getIdentity } from './core/identity'

type EmergencyRow={
  id:string
  member_id:string
  message:string|null
  created_at:string
  resolved_at:string|null
  emergency:boolean
}
type MemberRow={id:string;name:string;active:boolean}

let channel:ReturnType<typeof supabase.channel>|null=null
let activeMemberId=''
let activeAlerts:EmergencyRow[]=[]
let memberNames=new Map<string,string>()
let overlay:HTMLElement|null=null
let triggerBusy=false
let resolveBusy=false
let previousOverflow=''
let lastVibratedAlert=''
let authReady=false

function esc(value:string){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))}
function memberName(id:string){return memberNames.get(id)||'Un miembro de la familia'}
function age(value:string){
  const ms=Date.now()-new Date(value).getTime()
  if(!Number.isFinite(ms)||ms<60000)return'AHORA'
  const min=Math.floor(ms/60000)
  if(min<60)return`HACE ${min} MIN`
  const h=Math.floor(min/60)
  return`HACE ${h} H`
}

function injectStyles(){
  if(document.querySelector('#family-emergency-css'))return
  const style=document.createElement('style')
  style.id='family-emergency-css'
  style.textContent=`
  .family-emergency-screen{position:fixed;inset:0;z-index:2147483647;background:#a31318;color:#fff;display:flex;align-items:center;justify-content:center;padding:max(24px,env(safe-area-inset-top)) 22px max(26px,env(safe-area-inset-bottom));box-sizing:border-box;overflow:auto;overscroll-behavior:none}
  .family-emergency-screen::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 28%,rgba(255,255,255,.13),transparent 38%);animation:familyEmergencyPulse 1.35s ease-in-out infinite}
  @keyframes familyEmergencyPulse{50%{opacity:.35}}
  .family-emergency-inner{position:relative;width:min(100%,620px);text-align:center}
  .family-emergency-siren{width:82px;height:82px;margin:0 auto 22px;border:2px solid rgba(255,255,255,.72);border-radius:50%;display:grid;place-items:center;font:800 39px/1 system-ui;background:rgba(0,0,0,.09);box-shadow:0 0 0 10px rgba(255,255,255,.05)}
  .family-emergency-kicker{margin:0 0 15px;font:800 12px/1 system-ui;letter-spacing:.24em;text-transform:uppercase;opacity:.8}
  .family-emergency-name{margin:0;font:600 clamp(46px,13vw,82px)/.95 'Playfair Display',Georgia,serif;letter-spacing:-.035em;overflow-wrap:anywhere}
  .family-emergency-action{margin:13px 0 0;font:700 clamp(21px,6vw,31px)/1.15 system-ui}
  .family-emergency-copy{margin:16px auto 0;max-width:430px;font:500 16px/1.45 system-ui;opacity:.86}
  .family-emergency-time{display:inline-block;margin-top:22px;padding:8px 12px;border:1px solid rgba(255,255,255,.33);border-radius:999px;font:800 10px/1 system-ui;letter-spacing:.12em}
  .family-emergency-count{margin:11px 0 0;font:700 11px/1.4 system-ui;opacity:.72}
  .family-emergency-resolve{width:100%;min-height:58px;margin-top:34px;border:0;border-radius:18px;background:#fff;color:#8e1015;font:800 13px/1 system-ui;letter-spacing:.05em;padding:0 18px;box-shadow:0 12px 32px rgba(0,0,0,.18);cursor:pointer}
  .family-emergency-resolve:disabled{opacity:.6;cursor:wait}
  .family-emergency-foot{margin:13px auto 0;max-width:430px;font:600 10px/1.45 system-ui;opacity:.58}
  .family-emergency-error{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483647;transform:translateX(-50%);width:min(calc(100vw - 28px),440px);padding:13px 15px;border-radius:16px;background:#171716;color:#fff;text-align:center;font:700 12px/1.4 system-ui;box-shadow:0 12px 30px rgba(0,0,0,.28)}
  `
  document.head.appendChild(style)
}

function urgentVibrate(alertId:string){
  if(lastVibratedAlert===alertId)return
  lastVibratedAlert=alertId
  try{navigator.vibrate?.([650,180,650,180,950])}catch{}
}

function clearEmergencyQuery(){
  try{
    const url=new URL(location.href)
    if(!url.searchParams.has('emergency'))return
    url.searchParams.delete('emergency')
    history.replaceState(history.state,'',`${url.pathname}${url.search}${url.hash}`)
  }catch{}
}

function removeOverlay(){
  overlay?.remove();overlay=null
  if(previousOverflow||document.body.style.overflow==='hidden')document.body.style.overflow=previousOverflow
  previousOverflow=''
  lastVibratedAlert=''
  clearEmergencyQuery()
}

async function resolveAlert(alert:EmergencyRow,button:HTMLButtonElement){
  if(resolveBusy)return
  resolveBusy=true
  button.disabled=true
  button.textContent='ACTUALIZANDO…'
  try{
    const {data,error}=await supabase.functions.invoke('family-emergency',{body:{action:'resolve',alert_id:alert.id}})
    if(error||!data?.ok)throw error||new Error(data?.error||'EMERGENCY_RESOLVE_FAILED')
    await loadActive()
  }catch(error){
    console.error('Family emergency resolve failed',error)
    button.disabled=false
    button.textContent=alert.member_id===activeMemberId?'CANCELAR EMERGENCIA':'MARCAR COMO ATENDIDA'
    showError('No se pudo cerrar la emergencia. La alerta sigue activa.')
  }finally{resolveBusy=false}
}

function render(){
  const alert=activeAlerts[0]
  if(!alert){removeOverlay();return}
  injectStyles()
  const mine=alert.member_id===activeMemberId
  const name=memberName(alert.member_id)
  if(!overlay){
    previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    overlay=document.createElement('section')
    overlay.className='family-emergency-screen'
    overlay.setAttribute('role','alertdialog')
    overlay.setAttribute('aria-modal','true')
    overlay.setAttribute('aria-live','assertive')
    document.body.appendChild(overlay)
  }
  overlay.innerHTML=`<div class="family-emergency-inner"><div class="family-emergency-siren">!</div><p class="family-emergency-kicker">EMERGENCIA · FAMILIA NOA</p><h1 class="family-emergency-name">${esc(name)}</h1><p class="family-emergency-action">activó AYUDA</p><p class="family-emergency-copy">Necesita a su familia. Esta alerta tiene prioridad sobre toda la aplicación.</p><span class="family-emergency-time">${esc(age(alert.created_at))}</span>${activeAlerts.length>1?`<p class="family-emergency-count">${activeAlerts.length} emergencias activas</p>`:''}<button type="button" class="family-emergency-resolve" data-emergency-resolve>${mine?'CANCELAR EMERGENCIA':'MARCAR COMO ATENDIDA'}</button><p class="family-emergency-foot">La pantalla permanecerá activa hasta que alguien marque la emergencia como atendida.</p></div>`
  const button=overlay.querySelector<HTMLButtonElement>('[data-emergency-resolve]')
  button?.addEventListener('click',()=>void resolveAlert(alert,button))
  urgentVibrate(alert.id)
}

function showError(text:string){
  const old=document.querySelector('.family-emergency-error');old?.remove()
  const node=document.createElement('div');node.className='family-emergency-error';node.textContent=text;document.body.appendChild(node)
  window.setTimeout(()=>node.remove(),5000)
}

async function loadMembers(){
  const {data,error}=await supabase.from('family_members').select('id,name,active').eq('active',true)
  if(error)throw error
  memberNames=new Map(((data||[]) as MemberRow[]).map(row=>[row.id,row.name]))
}

async function loadActive(){
  if(!authReady)return
  try{
    const [alertsResult]=await Promise.all([
      supabase.from('help_alerts').select('id,member_id,message,created_at,resolved_at,emergency').eq('emergency',true).is('resolved_at',null).order('created_at',{ascending:false}).limit(10),
      loadMembers(),
    ])
    if(alertsResult.error)throw alertsResult.error
    activeAlerts=(alertsResult.data||[]) as EmergencyRow[]
    render()
  }catch(error){console.error('Family emergency load failed',error)}
}

function stopChannel(){channel?.unsubscribe();channel=null}
function startChannel(){
  stopChannel()
  channel=supabase.channel(`family-emergency-priority-${Date.now()}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'help_alerts'},()=>{void loadActive()})
    .subscribe()
}

async function activateRuntime(){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session){authReady=false;activeMemberId='';activeAlerts=[];stopChannel();removeOverlay();return}
  const identity=getIdentity()
  activeMemberId=identity?.memberId||String(session.user?.app_metadata?.member_id||'')
  authReady=!!activeMemberId
  if(!authReady)return
  startChannel()
  await loadActive()
}

async function triggerEmergency(){
  if(triggerBusy)return
  const identity=getIdentity()
  if(!identity?.memberId){showError('No se pudo identificar tu perfil.');return}
  triggerBusy=true
  try{
    const {data,error}=await supabase.functions.invoke('family-emergency',{body:{action:'trigger'}})
    if(error||!data?.ok)throw error||new Error(data?.error||'EMERGENCY_FAILED')
    await loadActive()
  }catch(error){
    console.error('Family emergency trigger failed',error)
    try{
      const {error:fallbackError}=await supabase.from('help_alerts').insert({member_id:identity.memberId,message:`${identity.name||'Familia'} activó AYUDA.`,emergency:true})
      if(fallbackError)throw fallbackError
      await loadActive()
      showError('Emergencia activada dentro de la app. El Push externo podría no haberse enviado.')
    }catch(fallbackError){
      console.error('Family emergency fallback failed',fallbackError)
      showError('NO SE PUDO ENVIAR LA EMERGENCIA. Comprueba tu conexión e inténtalo otra vez.')
    }
  }finally{triggerBusy=false}
}

injectStyles()

document.addEventListener('click',event=>{
  const target=(event.target as Element|null)?.closest('#help')
  if(!target)return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  void triggerEmergency()
},true)

supabase.auth.onAuthStateChange(()=>{window.setTimeout(()=>void activateRuntime(),0)})
window.addEventListener('focus',()=>void loadActive())
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void loadActive()})
void activateRuntime()

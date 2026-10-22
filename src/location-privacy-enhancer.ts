import { getIdentity } from './core/identity'
import { stopSharingOwnLocation, subscribeLocationState, isCurrentFamilyLocation, type LocationState } from './core/location-store'
import {
  hasNativeLocationCapability, isDeviceLocationEnabled,
  isNativeLocationSharingEnabled, getNativeLocationStatus,
  stopOwnLocationRealtime, isLocationStopPending,
  markLocationStopPending, clearLocationStopPending,
  syncOwnLocationNow,
} from './core/location-device-sync'

let latestState:LocationState|null=null
let busy=false
let observer:MutationObserver|null=null
let unsubscribe:(()=>void)|null=null
let activePage:HTMLElement|null=null
let deletionRetrying=false

// A phone may stop sharing without Internet. Keep the local OFF preference
// and delete its last server coordinate later, without re-enabling GPS.
async function retryPendingDeletion(){
  const memberId=getIdentity()?.memberId||''
  if(busy||deletionRetrying||!memberId||!isLocationStopPending(memberId)||
    navigator.onLine===false||
    (hasNativeLocationCapability()&&isNativeLocationSharingEnabled()))return
  deletionRetrying=true
  try{
    await stopSharingOwnLocation()
    clearLocationStopPending(memberId)
    apply()
  }catch(error){
    console.warn('Family GPS server deletion is still pending',error)
  }finally{deletionRetrying=false}
}

function ensureStyles(){
  if(document.querySelector('#location-sharing-ui-css'))return
  const style=document.createElement('style')
  style.id='location-sharing-ui-css'
  style.textContent=`
    /* The Android service owns tracking. The page only controls consent. */
    .location-page.location-gps-simple .locationbox{display:none!important}
    .location-gps-controls{
      box-sizing:border-box;display:flex;flex-direction:column;gap:12px;
      margin:12px 20px 22px;padding:15px 16px;border-radius:22px;
      background:rgba(255,255,255,.91);box-shadow:0 1px 12px rgba(0,0,0,.045);
    }
    .location-gps-status{font-size:12px;color:#696660;font-weight:600;line-height:1.4}
    .location-gps-buttons{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .location-gps-buttons button{
      min-height:50px;padding:9px 8px;border:1px solid #ddd9d1;border-radius:15px;
      background:#f4f2ef;color:#1d1d1c;font-size:13px;font-weight:750;cursor:pointer
    }
    .location-gps-buttons button[data-gps-enable]:not(:disabled),
    .location-gps-buttons button[data-gps-disable]:not(:disabled){
      background:#1b1b19;color:#fff;border-color:#1b1b19
    }
    .location-gps-buttons button:disabled{opacity:.48;cursor:default}
    @media(max-width:480px){.location-gps-controls{margin:10px 12px 18px}}
  `
  document.head.appendChild(style)
}

// The two familiar profiles configured for mandatory location still follow
// the existing protected enrollment rules; they cannot stop sharing via an
// optional screen because Supabase blocks that action.
function isOptionalLocationPage(page:HTMLElement){
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  const memberId=getIdentity()?.memberId||''
  let member=latestState?.members.find(item=>item.id===memberId)
  if(!member){
    try{
      const cached=JSON.parse(localStorage.getItem('familia-noa-home-bootstrap-v1')||'null')
      member=cached?.members?.find((item:{id:string})=>item.id===memberId)
    }catch{}
  }
  const mandatoryHeading=page.querySelector('.locationbox h2')?.textContent?.includes('Mantener ubicación al día')===true
  return !gated&&!!page.querySelector('#back')&&!mandatoryHeading&&member?.must_share_location===false
}

function ownLocation(state:LocationState){
  const memberId=getIdentity()?.memberId
  return memberId?state.locations.find(location=>location.member_id===memberId)||null:null
}

function ensureControls(page:HTMLElement){
  let panel=page.querySelector<HTMLElement>('[data-gps-controls]')
  if(panel)return panel
  const anchor=page.querySelector('.locationbox')
  if(!anchor)return null
  panel=document.createElement('section')
  panel.className='location-gps-controls'
  panel.dataset.gpsControls='1'
  panel.innerHTML=`
    <div class="location-gps-status" role="status" aria-live="polite" data-gps-status>GPS desactivado</div>
    <div class="location-gps-buttons">
      <button type="button" data-gps-enable>Activar GPS</button>
      <button type="button" data-gps-disable>Desactivar GPS</button>
    </div>
  `
  anchor.insertAdjacentElement('afterend',panel)

  panel.querySelector<HTMLButtonElement>('[data-gps-enable]')?.addEventListener('click',()=>{
    if(busy)return
    const memberId=getIdentity()?.memberId||''
    if(!memberId)return
    const original=page.querySelector<HTMLButtonElement>('#sharelocation')
    // The original action handles native permissions and system GPS settings.
    // An already authorized native tracker can refresh in place.
    if(hasNativeLocationCapability()&&isNativeLocationSharingEnabled()&&isDeviceLocationEnabled()){
      void syncOwnLocationNow(memberId)
    }else if(original&&!original.disabled){
      original.click()
    }
    apply()
  })

  panel.querySelector<HTMLButtonElement>('[data-gps-disable]')?.addEventListener('click',()=>{
    if(busy)return
    void(async()=>{
      busy=true
      apply()
      const memberId=getIdentity()?.memberId||''
      try{
        if(!memberId||!stopOwnLocationRealtime())throw new Error('NATIVE_GPS_STOP_UNCONFIRMED')
        // Native and browser tracking stop BEFORE any network activity.
        markLocationStopPending(memberId)
        apply()
        await stopSharingOwnLocation()
        clearLocationStopPending(memberId)
      }catch(error){
        console.warn('GPS stop / server cleanup incomplete',error)
        // If local stop succeeded, keep it OFF until the server retry works.
        // If it did not, leave the stop button enabled for another attempt.
      }finally{
        busy=false
        apply()
      }
    })()
  })
  return panel
}

function apply(){
  const page=document.querySelector<HTMLElement>('.location-page')
  activePage=page
  if(!page)return
  if(!isOptionalLocationPage(page)){
    page.classList.remove('location-gps-simple','location-sharing-active')
    page.querySelector('[data-gps-controls]')?.remove()
    return
  }

  page.classList.add('location-gps-simple')
  page.classList.remove('location-sharing-active')
  const panel=ensureControls(page)
  if(!panel)return
  const memberId=getIdentity()?.memberId||''
  const native=hasNativeLocationCapability()
  const requested=native?isNativeLocationSharingEnabled():false
  const status=getNativeLocationStatus()
  const pending=isLocationStopPending(memberId)
  const row=latestState?ownLocation(latestState):null
  const confirmed=!!row&&isCurrentFamilyLocation(row)
  // On the Android app the persisted consent is the source of truth; a
  // momentarily stale / missing server row must NOT switch the GPS back off.
  const on=!pending&&(native?requested:confirmed)
  const gpsOn=native?isDeviceLocationEnabled():true
  const tracking=native?(status?.tracking??requested):on

  let message='GPS desactivado'
  if(pending)message='GPS desactivado · sincronizando la desactivación'
  else if(on&&!gpsOn)message='Activa la ubicación del teléfono para continuar'
  else if(on&&!tracking)message='GPS activado · recuperando seguimiento'
  else if(on&&confirmed)message=`GPS activo · ubicación actual${row?.accuracy!=null?` · ±${Math.round(row.accuracy)} m`:''}`
  else if(on)message='GPS activo · buscando ubicación precisa'
  panel.querySelector<HTMLElement>('[data-gps-status]')!.textContent=message

  const enable=panel.querySelector<HTMLButtonElement>('[data-gps-enable]')
  const disable=panel.querySelector<HTMLButtonElement>('[data-gps-disable]')
  if(enable)enable.disabled=busy||(on&&gpsOn&&tracking)
  if(disable)disable.disabled=busy||!on
}

function scanPage(){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(page===activePage)return
  activePage=page
  apply()
}

ensureStyles()
unsubscribe=subscribeLocationState(state=>{
  latestState=state
  apply()
})

const app=document.querySelector('#app')
if(app){
  observer=new MutationObserver(scanPage)
  observer.observe(app,{childList:true})
}

window.addEventListener('familia-noa:native-location-state',apply)
window.addEventListener('familia-noa:android-resumed',()=>{
  apply()
  void retryPendingDeletion()
})
window.addEventListener('focus',()=>{
  apply()
  void retryPendingDeletion()
})
window.addEventListener('online',()=>void retryPendingDeletion())
window.addEventListener('pageshow',()=>void retryPendingDeletion())
window.addEventListener('familia-noa:identity-changed',()=>void retryPendingDeletion())
const statusTimer=window.setInterval(()=>{if(!document.hidden)apply()},10_000)

window.addEventListener('beforeunload',()=>{
  window.clearInterval(statusTimer)
  observer?.disconnect()
  unsubscribe?.()
  observer=null
  unsubscribe=null
},{once:true})
apply()
void retryPendingDeletion()

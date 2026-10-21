import { getIdentity } from './core/identity'
import { stopSharingOwnLocation, subscribeLocationState, isCurrentFamilyLocation, type LocationState } from './core/location-store'
import { hasNativeLocationCapability, isDeviceLocationEnabled, isNativeLocationSharingEnabled, getNativeLocationStatus, stopOwnLocationRealtime, isLocationStopPending, markLocationStopPending, clearLocationStopPending } from './core/location-device-sync'

let latestState:LocationState|null=null
let busy=false
let observer:MutationObserver|null=null
let unsubscribe:(()=>void)|null=null
let activePage:HTMLElement|null=null
let deletionRetrying=false

// Persist a pending remote deletion if network access is unavailable, but
// never delete a newly resumed stream automatically.
async function retryPendingDeletion(){
  const memberId=getIdentity()?.memberId||''
  if(busy||deletionRetrying||!memberId||!isLocationStopPending(memberId)||navigator.onLine===false||
    (hasNativeLocationCapability()&&isNativeLocationSharingEnabled()))return
  deletionRetrying=true
  try{
    await stopSharingOwnLocation()
    clearLocationStopPending(memberId)
    apply()
  }catch(error){console.warn('Family GPS server deletion is pending',error)}
  finally{deletionRetrying=false}
}

function ensureStyles(){
  if(document.querySelector('#location-sharing-ui-css'))return
  const style=document.createElement('style')
  style.id='location-sharing-ui-css'
  style.textContent=`
    .location-page.location-sharing-active .locationbox{display:none!important}
    .location-page.location-sharing-active .family-map-shell{
      height:var(--family-map-dynamic-height,min(52dvh,560px))!important;
      min-height:310px!important;
      margin-top:10px!important;
      margin-bottom:20px!important;
    }
    .location-sharing-footer{
      display:flex;
      justify-content:center;
      padding:4px 16px 28px;
    }
    .location-stop-share{
      border:0;
      background:transparent;
      color:#8a867e;
      font-size:10px;
      font-weight:700;
      text-decoration:underline;
      text-underline-offset:3px;
      padding:10px 12px;
    }
    .location-stop-share:disabled{opacity:.45}
    .location-sharing-footer{flex-direction:column;align-items:center}
    .location-native-stale{display:none;text-align:center;color:#9b5a32;font-size:12px;font-weight:650;line-height:1.5;padding:0 20px 8px}
    .location-native-stale.visible{display:block}
    @media(max-width:480px){
      .location-page.location-sharing-active .family-map-shell{
        height:var(--family-map-dynamic-height,min(52dvh,560px))!important;
        min-height:310px!important;
        margin-left:10px!important;
        margin-right:10px!important;
      }
    }
  `
  document.head.appendChild(style)
}

function isOptionalLocationPage(page:HTMLElement){
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  const memberId=getIdentity()?.memberId||''
  let member=latestState?.members.find(item=>item.id===memberId)
  // The GPS must remain switchable OFF while offline; the usual server member
  // list may be absent after a cold restart without Internet.
  if(!member){
    try{
      const cached=JSON.parse(localStorage.getItem('familia-noa-home-bootstrap-v1')||'null')
      member=cached?.members?.find((item:{id:string})=>item.id===memberId)
    }catch{}
  }
  // Mandatory screens have a different heading even when no list is cached.
  const mandatoryHeading=page.querySelector('.locationbox h2')?.textContent?.includes('Mantener ubicación al día')===true
  return !gated&&!!page.querySelector('#back')&&!mandatoryHeading&&member?.must_share_location===false
}

function ownLocation(state:LocationState){
  const memberId=getIdentity()?.memberId
  return memberId?state.locations.find(location=>location.member_id===memberId)||null:null
}

function removeStopControl(page:HTMLElement){
  page.querySelector('[data-location-sharing-footer]')?.remove()
}

function ensureStopControl(page:HTMLElement){
  if(page.querySelector('[data-location-sharing-footer]'))return
  const family=page.querySelector<HTMLElement>('#familylocations')
  if(!family)return

  const footer=document.createElement('div')
  footer.className='location-sharing-footer'
  footer.dataset.locationSharingFooter='1'

  const button=document.createElement('button')
  button.type='button'
  button.className='location-stop-share'
  button.dataset.stopLocation='1'
  button.textContent='Dejar de compartir ubicación'
  const stale=document.createElement('p')
  stale.className='location-native-stale'
  stale.setAttribute('role','status')
  stale.dataset.locationNativeStale='1'
  footer.appendChild(stale)
  footer.appendChild(button)
  family.insertAdjacentElement('afterend',footer)

  button.addEventListener('click',()=>{
    if(busy)return
    void(async()=>{
      busy=true
      button.disabled=true
      button.textContent='Desactivando…'
      try{
        const memberId=getIdentity()?.memberId||''
        if(!memberId||!stopOwnLocationRealtime())throw new Error('NATIVE_GPS_STOP_UNCONFIRMED')
        // Stop native/WebView tracking before depending on a network request.
        markLocationStopPending(memberId)
        apply()
        await stopSharingOwnLocation()
        clearLocationStopPending(memberId)
      }catch(error){
        console.error('Stop family location sharing failed',error)
        button.textContent=isLocationStopPending(getIdentity()?.memberId||'')
          ?'Reintentar eliminación de ubicación'
          :'No se pudo confirmar la detención · reintentar'
      }finally{
        busy=false
        button.disabled=false
        apply()
      }
    })()
  })
}

function apply(){
  const page=document.querySelector<HTMLElement>('.location-page')
  activePage=page
  if(!page||!latestState||!isOptionalLocationPage(page))return

  const memberId=getIdentity()?.memberId||''
  const row=ownLocation(latestState)
  const nativeRequired=hasNativeLocationCapability()
  const status=getNativeLocationStatus()
  const nativeRequested=isNativeLocationSharingEnabled()
  const pendingStop=isLocationStopPending(memberId)
  const tracking=status?.tracking??nativeRequested
  const deviceLocationOff=nativeRequired&&!isDeviceLocationEnabled()
  const serverRecent=!!row&&isCurrentFamilyLocation(row)
  const sharing=serverRecent&&(!nativeRequired||tracking)&&!pendingStop
  const needsRecovery=!pendingStop&&nativeRequired&&nativeRequested&&
    (deviceLocationOff||!tracking||!serverRecent)
  page.classList.toggle('location-sharing-active',sharing&&!needsRecovery)

  // A stale row or Android tracker which is requested but stopped must still
  // allow an optional profile to turn sharing off.
  if(row||nativeRequested||pendingStop){
    ensureStopControl(page)
    const notice=page.querySelector<HTMLElement>('[data-location-native-stale]')
    if(notice){
      const message=pendingStop
        ?'Seguimiento detenido en este teléfono. La eliminación de la última posición del servidor está pendiente de conexión.'
        :deviceLocationOff&&nativeRequested
          ?'La ubicación del teléfono está apagada. Reactívala para volver a compartir en tiempo real.'
          :nativeRequested&&!tracking
            ?'El seguimiento está solicitado, pero el rastreador Android no está activo.'
            :nativeRequested&&!serverRecent
              ?'Android está activado, pero Supabase todavía no confirma una posición reciente.'
              :''
      notice.classList.toggle('visible',!!message)
      notice.textContent=message
    }
  }else removeStopControl(page)

  const button=page.querySelector<HTMLButtonElement>('#sharelocation')
  const description=page.querySelector<HTMLElement>('#locationtext')
  if(needsRecovery&&button&&!button.disabled){
    // The original click handler in main.ts opens Android location settings
    // when GPS is off, otherwise restarts the existing native tracking owner.
    button.textContent=deviceLocationOff?'Activar GPS del teléfono':'Reintentar ubicación'
    if(description){
      description.textContent=deviceLocationOff
        ?'El GPS general del teléfono está apagado. Toca el botón para abrir los ajustes de Android.'
        :'La posición todavía no está confirmada por el servidor. Toca para reintentar.'
    }
  }
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
const staleRefresh=window.setInterval(()=>{if(!document.hidden)apply()},30_000)

window.addEventListener('beforeunload',()=>{
  window.clearInterval(staleRefresh)
  observer?.disconnect()
  observer=null
  unsubscribe?.()
  unsubscribe=null
},{once:true})

apply()
void retryPendingDeletion()

import { getIdentity } from './core/identity'
import { stopSharingOwnLocation, subscribeLocationState, type LocationState } from './core/location-store'
import { hasNativeLocationCapability, isDeviceLocationEnabled, isNativeLocationSharingEnabled, stopOwnLocationRealtime } from './core/location-device-sync'

let latestState:LocationState|null=null
let busy=false
let observer:MutationObserver|null=null
let unsubscribe:(()=>void)|null=null
let activePage:HTMLElement|null=null

function ensureStyles(){
  if(document.querySelector('#location-sharing-ui-css'))return
  const style=document.createElement('style')
  style.id='location-sharing-ui-css'
  style.textContent=`
    .location-page.location-sharing-active .locationbox{display:none!important}
    .location-page.location-sharing-active .family-map-shell{
      height:min(66dvh,620px)!important;
      min-height:390px!important;
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
    .family-pending-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin:2px 0 12px;padding:15px 18px;border:1px solid #e6e0d6;border-radius:18px;background:#f9f7f2;color:#35312b;font-size:12px;font-weight:700;text-align:left;cursor:pointer}
    .family-pending-toggle span{font-size:20px;color:#82796e;font-weight:400}
    .location-native-stale{display:none;text-align:center;color:#9b5a32;font-size:12px;font-weight:650;line-height:1.5;padding:0 20px 8px}
    .location-native-stale.visible{display:block}
    @media(max-width:480px){
      .location-page.location-sharing-active .family-map-shell{
        height:60dvh!important;
        min-height:360px!important;
        margin-left:10px!important;
        margin-right:10px!important;
      }
    }
  `
  document.head.appendChild(style)
}

function isOptionalLocationPage(page:HTMLElement){
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  return !gated&&!!page.querySelector('#back')
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
        await stopSharingOwnLocation()
        stopOwnLocationRealtime()
      }catch(error){
        console.error('Stop family location sharing failed',error)
        button.disabled=false
        button.textContent='Dejar de compartir ubicación'
      }finally{
        busy=false
      }
    })()
  })
}

function apply(){
  const page=document.querySelector<HTMLElement>('.location-page')
  activePage=page
  if(!page||!latestState||!isOptionalLocationPage(page))return

  const row=ownLocation(latestState)
  const nativeRequired=hasNativeLocationCapability()
  const sharing=!!row&&(!nativeRequired||isNativeLocationSharingEnabled())
  const deviceLocationOff=nativeRequired&&!isDeviceLocationEnabled()
  const age=row?Date.now()-Date.parse(row.updated_at):NaN
  const stalled=sharing&&Number.isFinite(age)&&age>120_000
  // An Android sharing preference means the user requested tracking, not that
  // system GPS is on or that the server is currently receiving new positions.
  // Always expose the existing activation button if either condition fails.
  const needsRecovery=sharing&&(deviceLocationOff||stalled)
  page.classList.toggle('location-sharing-active',sharing&&!needsRecovery)

  if(sharing){
    ensureStopControl(page)
    const notice=page.querySelector<HTMLElement>('[data-location-native-stale]')
    if(notice){
      notice.classList.toggle('visible',needsRecovery)
      notice.textContent=deviceLocationOff
        ?'La ubicación del teléfono está apagada. Reactívala para volver a compartir en tiempo real.'
        :stalled
          ?'No hemos recibido una posición nueva. Puedes volver a intentar el seguimiento.'
          :''
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
        :'Tu última ubicación ya no está actualizada. Toca el botón para obtener una posición nueva.'
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
window.addEventListener('familia-noa:android-resumed',apply)
window.addEventListener('focus',apply)
const staleRefresh=window.setInterval(()=>{if(!document.hidden)apply()},30_000)

window.addEventListener('beforeunload',()=>{
  window.clearInterval(staleRefresh)
  observer?.disconnect()
  observer=null
  unsubscribe?.()
  unsubscribe=null
},{once:true})

apply()

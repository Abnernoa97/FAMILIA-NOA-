import { getIdentity } from './core/identity'
import { stopSharingOwnLocation, subscribeLocationState, type LocationState } from './core/location-store'
import { hasNativeLocationCapability, isNativeLocationSharingEnabled, stopOwnLocationRealtime } from './core/location-device-sync'

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
      height:min(76dvh,680px)!important;
      min-height:520px!important;
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
    @media(max-width:480px){
      .location-page.location-sharing-active .family-map-shell{
        height:72dvh!important;
        min-height:500px!important;
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

  const hasOwnLocation=!!ownLocation(latestState)
  const nativeRequired=hasNativeLocationCapability()
  const sharing=hasOwnLocation&&(!nativeRequired||isNativeLocationSharingEnabled())
  page.classList.toggle('location-sharing-active',sharing)

  if(sharing)ensureStopControl(page)
  else removeStopControl(page)
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

window.addEventListener('beforeunload',()=>{
  observer?.disconnect()
  observer=null
  unsubscribe?.()
  unsubscribe=null
},{once:true})

apply()

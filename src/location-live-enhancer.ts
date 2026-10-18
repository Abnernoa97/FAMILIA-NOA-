import { getIdentity } from './core/identity'
import {
  isLocationLive,
  saveLiveLocation,
  stopLiveLocation,
  subscribeLocationState,
  type LocationState,
} from './core/location-store'

type NativeState={ok?:boolean;status?:string;active?:boolean;endsAt?:number}
type NativeBridge={
  getLiveLocationState?:()=>string
  startLiveLocation?:(minutes:number)=>string
  stopLiveLocation?:()=>string
}

type WebSession={
  memberId:string
  startedAt:string
  endsAt:number
}

const STORAGE_KEY='familia-noa-web-live-location'
const MIN_WRITE_MS=15_000
const HEARTBEAT_MS=60_000
const MIN_MOVE_METERS=8

let state:LocationState|null=null
let nativeState:NativeState|null=null
let watchId:number|null=null
let heartbeat:number|null=null
let expiry:number|null=null
let lastPosition:GeolocationPosition|null=null
let lastWriteAt=0
let writing=false
let busy=false
let lastError=''

function nativeBridge():NativeBridge|null{
  const value=(window as any).FamiliaNoaNative as NativeBridge|undefined
  return value&&typeof value.startLiveLocation==='function'&&typeof value.stopLiveLocation==='function'?value:null
}

function parseNative(value:unknown):NativeState|null{
  try{return typeof value==='string'?JSON.parse(value):value as NativeState}catch{return null}
}

function readNative(){
  const bridge=nativeBridge()
  if(!bridge?.getLiveLocationState)return null
  try{nativeState=parseNative(bridge.getLiveLocationState());return nativeState}catch{return null}
}

function identity(){
  return getIdentity()
}

function ownLocation(){
  const id=identity()?.memberId
  return id&&state?state.locations.find(item=>item.member_id===id)||null:null
}

function readWebSession():WebSession|null{
  try{
    const raw=localStorage.getItem(STORAGE_KEY)
    if(!raw)return null
    const parsed=JSON.parse(raw) as WebSession
    const current=identity()?.memberId
    if(!parsed?.memberId||parsed.memberId!==current){
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    if(parsed.endsAt>0&&parsed.endsAt<=Date.now()){
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  }catch{
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function writeWebSession(session:WebSession|null){
  if(session)localStorage.setItem(STORAGE_KEY,JSON.stringify(session))
  else localStorage.removeItem(STORAGE_KEY)
}

function sessionEndsAt(){
  if(nativeState?.active&&Number(nativeState.endsAt)>0)return Number(nativeState.endsAt)
  const web=readWebSession()
  if(web?.endsAt)return web.endsAt
  const row=ownLocation()
  const value=row?.live_until?new Date(row.live_until).getTime():0
  return Number.isFinite(value)?value:0
}

function remainingText(){
  const end=sessionEndsAt()
  if(!end)return 'Hasta que la apagues'
  const minutes=Math.max(1,Math.ceil((end-Date.now())/60_000))
  if(minutes>=60){
    const hours=Math.floor(minutes/60)
    const rest=minutes%60
    return rest?hours+' h '+rest+' min restantes':hours+' h restante'+(hours===1?'':'s')
  }
  return minutes+' min restantes'
}

function isActive(){
  const row=ownLocation()
  return !!nativeState?.active||!!readWebSession()||!!row&&isLocationLive(row)
}

function distanceMeters(a:GeolocationPosition,b:GeolocationPosition){
  const toRad=(value:number)=>value*Math.PI/180
  const lat1=toRad(a.coords.latitude)
  const lat2=toRad(b.coords.latitude)
  const dLat=lat2-lat1
  const dLon=toRad(b.coords.longitude-a.coords.longitude)
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))
}

async function uploadWebPosition(position:GeolocationPosition,force=false){
  const session=readWebSession()
  if(!session||writing)return
  if(session.endsAt>0&&session.endsAt<=Date.now()){
    await stopWebLive()
    return
  }

  const latitude=position.coords.latitude
  const longitude=position.coords.longitude
  const accuracy=position.coords.accuracy
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<-90||latitude>90||longitude<-180||longitude>180)return

  const moved=!lastPosition||distanceMeters(lastPosition,position)>=MIN_MOVE_METERS
  const elapsed=Date.now()-lastWriteAt
  lastPosition=position
  if(!force&&!moved&&elapsed<MIN_WRITE_MS)return
  if(!force&&elapsed<MIN_WRITE_MS)return

  writing=true
  lastError=''
  try{
    await saveLiveLocation({
      memberId:session.memberId,
      latitude,
      longitude,
      accuracy:Number.isFinite(accuracy)?accuracy:null,
      startedAt:session.startedAt,
      until:session.endsAt>0?new Date(session.endsAt).toISOString():null,
    })
    lastWriteAt=Date.now()
  }catch(error){
    console.error('Web live location update failed',error)
    lastError=navigator.onLine?'No se pudo actualizar en este momento.':'Sin conexión · se reintentará al volver.'
  }finally{
    writing=false
    render()
  }
}

function stopWebWatch(){
  if(watchId!==null&&navigator.geolocation){
    navigator.geolocation.clearWatch(watchId)
    watchId=null
  }
  if(heartbeat!==null){window.clearInterval(heartbeat);heartbeat=null}
  if(expiry!==null){window.clearTimeout(expiry);expiry=null}
}

function ensureWebWatch(){
  const session=readWebSession()
  if(!session||!navigator.geolocation)return
  if(session.endsAt>0&&session.endsAt<=Date.now()){
    void stopWebLive()
    return
  }
  if(watchId===null){
    watchId=navigator.geolocation.watchPosition(
      position=>{lastPosition=position;void uploadWebPosition(position,false)},
      error=>{
        console.warn('Web live location watch failed',error)
        lastError=error.code===1
          ?'Permiso de ubicación desactivado.'
          :error.code===2
            ?'GPS no disponible en este momento.'
            :'Esperando una nueva posición…'
        render()
      },
      {enableHighAccuracy:true,maximumAge:5000,timeout:30000}
    )
  }
  if(heartbeat===null){
    heartbeat=window.setInterval(()=>{
      if(lastPosition)void uploadWebPosition(lastPosition,true)
    },HEARTBEAT_MS)
  }
  if(expiry===null&&session.endsAt>0){
    expiry=window.setTimeout(()=>{void stopWebLive()},Math.max(250,session.endsAt-Date.now()))
  }
}

async function startWebLive(minutes:number){
  if(!navigator.geolocation)throw new Error('GEOLOCATION_UNAVAILABLE')
  const current=identity()
  if(!current?.memberId)throw new Error('FAMILY_SESSION_REQUIRED')
  const now=Date.now()
  const session:WebSession={
    memberId:current.memberId,
    startedAt:new Date(now).toISOString(),
    endsAt:minutes>0?now+minutes*60_000:0,
  }
  writeWebSession(session)
  lastWriteAt=0
  lastError=''
  ensureWebWatch()
  render()
}

async function stopWebLive(){
  const current=identity()
  stopWebWatch()
  writeWebSession(null)
  lastError=''
  if(current?.memberId){
    try{await stopLiveLocation(current.memberId)}
    catch(error){console.error('Stop web live location failed',error)}
  }
  render()
}

function ensureCss(){
  if(document.querySelector('#location-live-css'))return
  const style=document.createElement('style')
  style.id='location-live-css'
  style.textContent=`
    .location-live-open{width:100%;margin-top:10px;padding:14px;border:1px solid #171716;border-radius:16px;background:#fff;color:#171716;font-weight:750}
    .location-live-options{display:flex;gap:6px;margin-top:8px}.location-live-options[hidden]{display:none!important}
    .location-live-options button{flex:1;padding:11px 5px;border-radius:13px;background:#eee9e0;color:#171716;font-size:9px;font-weight:750}
    .location-live-active{margin-top:10px;padding:13px;border-radius:17px;background:#171716;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px}
    .location-live-active small{display:block;color:#8fca9f;font-size:8px;font-weight:800;letter-spacing:.12em}.location-live-active b{display:block;margin-top:3px;font:500 16px var(--display-font,Georgia,serif)}
    .location-live-active span{display:block;margin-top:3px;color:#bbb7af;font-size:9px}.location-live-stop{padding:9px 11px;border-radius:999px;background:#f5f2eb;color:#171716;font-size:9px;font-weight:800}
    .location-live-note{margin:8px 2px 0;color:#8a867e;font-size:9px;line-height:1.4}.location-live-note.error{color:#8a5145}
  `
  document.head.appendChild(style)
}

function render(){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(!page||!page.querySelector('#back'))return
  const box=page.querySelector<HTMLElement>('.locationbox')
  const primary=page.querySelector<HTMLButtonElement>('#sharelocation')
  if(!box||!primary)return

  const native=nativeBridge()
  const live=isActive()
  const mode=(live?'active':'idle')+(native?'-native':'-web')
  let root=box.querySelector<HTMLElement>('[data-live-root]')

  if(root?.dataset.mode===mode){
    primary.hidden=live
    const remaining=root.querySelector<HTMLElement>('[data-live-remaining]')
    if(remaining)remaining.textContent=remainingText()
    const note=root.querySelector<HTMLElement>('[data-live-note]')
    if(note){
      note.textContent=lastError||(native
        ?'Android mantiene esta sesión en segundo plano.'
        :'Funciona mientras FAMILIA NOA siga activa. Si Android la suspende, deja de mostrarse EN VIVO automáticamente.')
      note.classList.toggle('error',!!lastError)
    }
    return
  }

  root?.remove()
  root=document.createElement('div')
  root.dataset.liveRoot='1'
  root.dataset.mode=mode

  if(live){
    primary.hidden=true
    root.innerHTML=`
      <section class="location-live-active">
        <div><small>UBICACIÓN EN VIVO</small><b>Compartiendo con la familia</b><span data-live-remaining>${remainingText()}</span></div>
        <button type="button" class="location-live-stop" data-live-stop>Detener</button>
      </section>
      <div class="location-live-note${lastError?' error':''}" data-live-note>${lastError||(native?'Android mantiene esta sesión en segundo plano.':'Funciona mientras FAMILIA NOA siga activa. Si Android la suspende, deja de mostrarse EN VIVO automáticamente.')}</div>`
    root.querySelector('[data-live-stop]')?.addEventListener('click',()=>void stopLive())
  }else{
    primary.hidden=false
    root.innerHTML=`
      <button type="button" class="location-live-open" data-live-open>Compartir ubicación en vivo</button>
      <div class="location-live-options" data-live-options hidden>
        <button type="button" data-min="15">15 min</button>
        <button type="button" data-min="60">1 hora</button>
        <button type="button" data-min="0">Hasta apagar</button>
      </div>
      <div class="location-live-note${lastError?' error':''}" data-live-note>${lastError||(native?'Disponible en segundo plano con Android.':'Sin instalar nada nuevo · funciona con la app actual.')}</div>`
    root.querySelector('[data-live-open]')?.addEventListener('click',()=>{
      const options=root?.querySelector<HTMLElement>('[data-live-options]')
      if(options)options.hidden=!options.hidden
    })
    root.querySelectorAll<HTMLButtonElement>('[data-min]').forEach(button=>{
      button.addEventListener('click',()=>void startLive(Number(button.dataset.min||15)))
    })
  }
  box.appendChild(root)
}

async function startLive(minutes:number){
  if(busy)return
  busy=true
  lastError=''
  try{
    const native=nativeBridge()
    if(native){
      const result=parseNative(native.startLiveLocation?.(minutes))
      if(result?.status==='permission-required'){
        lastError='Autoriza el permiso de ubicación. Se activará automáticamente.'
      }else if(result?.ok===false){
        lastError='No se pudo activar la ubicación en vivo.'
      }else{
        nativeState={active:true,status:'starting',endsAt:minutes>0?Date.now()+minutes*60_000:0}
      }
    }else{
      await startWebLive(minutes)
    }
  }catch(error){
    console.error('Live location start failed',error)
    lastError='No se pudo activar la ubicación en vivo.'
  }finally{
    busy=false
    render()
  }
}

async function stopLive(){
  if(busy)return
  busy=true
  try{
    const native=nativeBridge()
    if(native&&nativeState?.active){
      native.stopLiveLocation?.()
      nativeState={active:false,status:'stopping',endsAt:0}
      window.setTimeout(()=>{readNative();render()},900)
    }else{
      await stopWebLive()
    }
  }catch(error){
    console.error('Live location stop failed',error)
    lastError='No se pudo detener todavía. Inténtalo de nuevo.'
  }finally{
    busy=false
    render()
  }
}

function scan(){
  if(!document.querySelector('.location-page'))return
  if(nativeBridge())readNative()
  if(readWebSession())ensureWebWatch()
  render()
}

ensureCss()
const unsubscribe=subscribeLocationState(next=>{state=next;render()})
const observer=new MutationObserver(scan)
observer.observe(document.body,{childList:true,subtree:true})

window.addEventListener('familia-noa:live-location-native',event=>{
  nativeState=(event as CustomEvent<NativeState>).detail||readNative()
  render()
})

document.addEventListener('visibilitychange',()=>{
  const session=readWebSession()
  if(!document.hidden&&session){
    ensureWebWatch()
    if(lastPosition)void uploadWebPosition(lastPosition,true)
  }
})

window.addEventListener('online',()=>{
  if(readWebSession()){
    ensureWebWatch()
    if(lastPosition)void uploadWebPosition(lastPosition,true)
  }
})

const clock=window.setInterval(()=>{
  const session=readWebSession()
  if(session?.endsAt&&session.endsAt<=Date.now()){
    void stopWebLive()
    return
  }
  if(document.querySelector('.location-page')){
    if(nativeBridge())readNative()
    render()
  }
},15_000)

window.addEventListener('beforeunload',()=>{
  observer.disconnect()
  unsubscribe()
  if(clock!==null)window.clearInterval(clock)
  stopWebWatch()
},{once:true})

scan()

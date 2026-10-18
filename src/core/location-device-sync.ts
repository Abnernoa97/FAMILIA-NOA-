import { getMemberId } from './identity'
import { getLocationState, refreshLocationState, saveOwnLocation } from './location-store'

const MIN_WRITE_GAP_MS=4_000
const MAX_SILENCE_MS=20_000
const MIN_MOVE_METERS=2.5

type NativeLocationBridge={
  locationCapability?:()=>string
  isLocationSharingEnabled?:()=>boolean
  startLocationSharing?:()=>boolean
  stopLocationSharing?:()=>boolean
  refreshLocationSharing?:()=>boolean
}

let activeMemberId=''
let watchId:number|null=null
let lastPosition:GeolocationPosition|null=null
let lastWriteAt=0
let writing=false

function nativeBridge():NativeLocationBridge|null{
  const value=(window as any).FamiliaNoaNative as NativeLocationBridge|undefined
  if(!value||typeof value.locationCapability!=='function')return null
  try{
    return value.locationCapability()==='native-background-location-v1'?value:null
  }catch{
    return null
  }
}

function nativeSharingEnabled(bridge=nativeBridge()){
  if(!bridge||typeof bridge.isLocationSharingEnabled!=='function')return false
  try{return bridge.isLocationSharingEnabled()===true}catch{return false}
}

function verifyNativeStart(memberId:string,bridge:NativeLocationBridge){
  window.setTimeout(()=>{
    if(activeMemberId!==memberId)return
    if(nativeSharingEnabled(bridge)){
      stopWebWatch()
      return
    }
    startWebWatch()
  },1800)
}

function valid(position:GeolocationPosition){
  const {latitude,longitude}=position.coords
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&
    latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180
}

function distanceMeters(a:GeolocationPosition,b:GeolocationPosition){
  const rad=(value:number)=>value*Math.PI/180
  const lat1=rad(a.coords.latitude)
  const lat2=rad(b.coords.latitude)
  const dLat=lat2-lat1
  const dLon=rad(b.coords.longitude-a.coords.longitude)
  const h=Math.sin(dLat/2)**2+
    Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))
}

async function persist(position:GeolocationPosition,force=false){
  if(!activeMemberId||writing||!valid(position))return false

  const now=Date.now()
  const moved=!lastPosition||distanceMeters(lastPosition,position)>=MIN_MOVE_METERS
  const accuracyImproved=!!lastPosition&&
    Number.isFinite(position.coords.accuracy)&&
    Number.isFinite(lastPosition.coords.accuracy)&&
    position.coords.accuracy+5<lastPosition.coords.accuracy

  if(!force&&now-lastWriteAt<MIN_WRITE_GAP_MS)return false
  if(!force&&lastPosition&&!moved&&!accuracyImproved&&now-lastWriteAt<MAX_SILENCE_MS){
    lastPosition=position
    return false
  }

  lastPosition=position
  writing=true
  try{
    await saveOwnLocation({
      memberId:activeMemberId,
      latitude:position.coords.latitude,
      longitude:position.coords.longitude,
      accuracy:Number.isFinite(position.coords.accuracy)?position.coords.accuracy:null,
    })
    lastWriteAt=Date.now()
    return true
  }catch(error){
    console.warn('Realtime family location update failed',error)
    return false
  }finally{
    writing=false
  }
}

function startWebWatch(){
  if(!activeMemberId||watchId!==null||!navigator.geolocation)return
  watchId=navigator.geolocation.watchPosition(
    position=>{void persist(position,false)},
    error=>console.warn('Realtime family GPS watch failed',error),
    {enableHighAccuracy:true,maximumAge:0,timeout:30_000}
  )
}

function stopWebWatch(){
  if(watchId!==null&&navigator.geolocation){
    navigator.geolocation.clearWatch(watchId)
    watchId=null
  }
}

function useNativeIfAlreadyEnabled(memberId:string){
  const bridge=nativeBridge()
  if(!bridge||!nativeSharingEnabled(bridge))return false
  activeMemberId=memberId
  stopWebWatch()
  return true
}

export function startOwnLocationRealtime(memberId=getMemberId(),activateNative=true){
  if(!memberId)return
  activeMemberId=memberId

  const bridge=nativeBridge()
  if(bridge){
    if(nativeSharingEnabled(bridge)){
      stopWebWatch()
      return
    }
    if(activateNative&&typeof bridge.startLocationSharing==='function'){
      try{
        if(bridge.startLocationSharing()===true){
          stopWebWatch()
          verifyNativeStart(memberId,bridge)
          return
        }
      }catch(error){
        console.warn('Native background location start failed',error)
      }
    }
  }

  startWebWatch()
}

export function ensureOwnLocationRealtime(){
  const memberId=getMemberId()
  if(!memberId)return
  const sharing=getLocationState().locations.some(location=>location.member_id===memberId)
  if(!sharing)return

  if(useNativeIfAlreadyEnabled(memberId))return
  startOwnLocationRealtime(memberId,false)
}

export function stopOwnLocationRealtime(){
  const bridge=nativeBridge()
  if(bridge&&typeof bridge.stopLocationSharing==='function'){
    try{bridge.stopLocationSharing()}catch(error){console.warn('Native background location stop failed',error)}
  }
  stopWebWatch()
  activeMemberId=''
  lastPosition=null
  lastWriteAt=0
}

export async function syncOwnLocationNow(memberId=getMemberId()){
  if(!memberId)return false

  const bridge=nativeBridge()
  if(bridge&&nativeSharingEnabled(bridge)&&typeof bridge.refreshLocationSharing==='function'){
    try{
      bridge.refreshLocationSharing()
      void refreshLocationState({force:true})
      return true
    }catch(error){
      console.warn('Native location refresh failed',error)
    }
  }

  if(!navigator.geolocation)return false
  startOwnLocationRealtime(memberId,false)
  return new Promise<boolean>(resolve=>{
    navigator.geolocation.getCurrentPosition(
      position=>{
        void persist(position,true).then(resolve)
      },
      error=>{
        console.warn('Immediate family location refresh failed',error)
        resolve(false)
      },
      {enableHighAccuracy:true,timeout:20_000,maximumAge:0}
    )
  })
}

export async function refreshMemberLocation(memberId:string){
  const ownId=getMemberId()
  if(memberId&&memberId===ownId){
    void syncOwnLocationNow(ownId)
  }
  return refreshLocationState({force:true})
}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden)return
  const memberId=getMemberId()
  if(!memberId)return

  if(useNativeIfAlreadyEnabled(memberId)){
    const bridge=nativeBridge()
    try{bridge?.refreshLocationSharing?.()}catch{}
    return
  }

  if(activeMemberId){
    startWebWatch()
    void syncOwnLocationNow(activeMemberId)
  }else{
    ensureOwnLocationRealtime()
  }
})

window.addEventListener('beforeunload',()=>{
  stopWebWatch()
},{once:true})

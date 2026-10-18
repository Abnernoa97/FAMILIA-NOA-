import { getMemberId } from './identity'
import { getLocationState, refreshLocationState, saveOwnLocation } from './location-store'

const MIN_WRITE_GAP_MS=4_000
const MIN_MOVE_METERS=2.5

let activeMemberId=''
let watchId:number|null=null
let lastPosition:GeolocationPosition|null=null
let lastWriteAt=0
let writing=false

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
  if(!force&&lastPosition&&!moved&&!accuracyImproved){
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

function startWatch(){
  if(!activeMemberId||watchId!==null||!navigator.geolocation)return
  watchId=navigator.geolocation.watchPosition(
    position=>{void persist(position,false)},
    error=>console.warn('Realtime family GPS watch failed',error),
    {enableHighAccuracy:true,maximumAge:0,timeout:30_000}
  )
}

function stopWatch(){
  if(watchId!==null&&navigator.geolocation){
    navigator.geolocation.clearWatch(watchId)
    watchId=null
  }
}

export function startOwnLocationRealtime(memberId=getMemberId()){
  if(!memberId)return
  if(activeMemberId!==memberId){
    stopWatch()
    activeMemberId=memberId
    lastPosition=null
    lastWriteAt=0
  }
  startWatch()
}

export function ensureOwnLocationRealtime(){
  const memberId=getMemberId()
  if(!memberId)return
  const sharing=getLocationState().locations.some(location=>location.member_id===memberId)
  if(sharing)startOwnLocationRealtime(memberId)
}

export function stopOwnLocationRealtime(){
  stopWatch()
  activeMemberId=''
  lastPosition=null
  lastWriteAt=0
}

export async function syncOwnLocationNow(memberId=getMemberId()){
  if(!memberId||!navigator.geolocation)return false
  startOwnLocationRealtime(memberId)
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
  if(activeMemberId){
    startWatch()
    void syncOwnLocationNow(activeMemberId)
  }else{
    ensureOwnLocationRealtime()
  }
})

window.addEventListener('beforeunload',stopOwnLocationRealtime,{once:true})

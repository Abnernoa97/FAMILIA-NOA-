import { getMemberId } from './identity'
import { getLocationState, refreshLocationState, saveOwnLocation } from './location-store'

const AUTO_SYNC_MS=30_000

let activeMemberId=''
let timer:number|null=null
let syncing=false

function currentPosition(){
  return new Promise<GeolocationPosition>((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error('GEOLOCATION_UNAVAILABLE'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      reject,
      {enableHighAccuracy:true,timeout:20_000,maximumAge:5_000}
    )
  })
}

export async function syncOwnLocationNow(memberId=getMemberId()){
  if(!memberId||syncing||document.hidden)return false
  syncing=true
  try{
    const position=await currentPosition()
    const latitude=position.coords.latitude
    const longitude=position.coords.longitude
    const accuracy=position.coords.accuracy
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<-90||latitude>90||longitude<-180||longitude>180){
      return false
    }
    await saveOwnLocation({
      memberId,
      latitude,
      longitude,
      accuracy:Number.isFinite(accuracy)?accuracy:null,
    })
    return true
  }catch(error){
    console.warn('Automatic family location sync failed',error)
    return false
  }finally{
    syncing=false
  }
}

function clearTimer(){
  if(timer!==null){
    window.clearInterval(timer)
    timer=null
  }
}

export function startOwnLocationAutoSync(memberId=getMemberId()){
  if(!memberId)return
  activeMemberId=memberId
  clearTimer()
  void syncOwnLocationNow(activeMemberId)
  timer=window.setInterval(()=>{
    if(!document.hidden&&activeMemberId)void syncOwnLocationNow(activeMemberId)
  },AUTO_SYNC_MS)
}

export function ensureOwnLocationAutoSync(){
  const memberId=getMemberId()
  if(!memberId)return
  const sharing=getLocationState().locations.some(location=>location.member_id===memberId)
  if(sharing&&activeMemberId!==memberId)startOwnLocationAutoSync(memberId)
}

export function stopOwnLocationAutoSync(){
  activeMemberId=''
  clearTimer()
}

export async function refreshMemberLocation(memberId:string){
  const ownId=getMemberId()
  if(memberId&&memberId===ownId){
    await syncOwnLocationNow(ownId)
    return refreshLocationState({force:true})
  }
  return refreshLocationState({force:true})
}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&activeMemberId)void syncOwnLocationNow(activeMemberId)
})

window.addEventListener('beforeunload',stopOwnLocationAutoSync,{once:true})

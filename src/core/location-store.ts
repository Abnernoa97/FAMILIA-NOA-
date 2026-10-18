import { supabase } from '../supabase'

export type LocationMember={
  id:string
  name:string
  active:boolean
  must_share_location:boolean
}

export type FamilyLocation={
  member_id:string
  latitude:number
  longitude:number
  accuracy:number|null
  updated_at:string
}

export type LocationProfile={
  member_id:string
  avatar_path:string|null
}

export type LocationSyncStatus='connecting'|'connected'|'reconnecting'|'offline'

export type LocationState={
  members:LocationMember[]
  locations:FamilyLocation[]
  profiles:LocationProfile[]
  loading:boolean
  error:string|null
  updatedAt:number
  revision:number
  syncStatus:LocationSyncStatus
}

type Listener=(state:LocationState)=>void

let state:LocationState={
  members:[],
  locations:[],
  profiles:[],
  loading:false,
  error:null,
  updatedAt:0,
  revision:0,
  syncStatus:navigator.onLine?'connecting':'offline',
}
let inflight:Promise<LocationState>|null=null
let channel:ReturnType<typeof supabase.channel>|null=null
let refreshTimer:number|null=null
let reconnectTimer:number|null=null
let reconnectAttempt=0
const listeners=new Set<Listener>()
const CACHE_TTL_MS=10_000

function publish(){
  const snapshot=getLocationState()
  listeners.forEach(listener=>{
    try{listener(snapshot)}catch(error){console.warn('Location state listener failed',error)}
  })
}

export function getLocationState():LocationState{
  return {
    ...state,
    members:[...state.members],
    locations:[...state.locations],
    profiles:[...state.profiles],
  }
}

function validCoordinate(row:FamilyLocation){
  return Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)&&
    row.latitude>=-90&&row.latitude<=90&&row.longitude>=-180&&row.longitude<=180
}

function setSyncStatus(syncStatus:LocationSyncStatus){
  if(state.syncStatus===syncStatus)return
  state={...state,syncStatus,revision:state.revision+1}
  publish()
}

function scheduleRealtimeRefresh(){
  if(refreshTimer!==null)window.clearTimeout(refreshTimer)
  refreshTimer=window.setTimeout(()=>{
    refreshTimer=null
    void refreshLocationState({force:true})
  },90)
}

function teardownRealtime(){
  if(channel){
    try{void channel.unsubscribe()}catch{}
    channel=null
  }
}

function scheduleReconnect(){
  if(!navigator.onLine){
    setSyncStatus('offline')
    return
  }
  if(reconnectTimer!==null)return
  reconnectAttempt=Math.min(reconnectAttempt+1,6)
  const delay=Math.min(1000*(2**(reconnectAttempt-1)),15000)
  setSyncStatus('reconnecting')
  reconnectTimer=window.setTimeout(()=>{
    reconnectTimer=null
    teardownRealtime()
    startRealtime()
  },delay)
}

function startRealtime(){
  if(channel||!listeners.size)return
  if(!navigator.onLine){
    setSyncStatus('offline')
    return
  }
  setSyncStatus(reconnectAttempt?'reconnecting':'connecting')
  channel=supabase.channel('familia-noa-location-state')
    .on('postgres_changes',{event:'*',schema:'public',table:'locations'},scheduleRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'family_members'},scheduleRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'family_profiles'},scheduleRealtimeRefresh)
    .subscribe(status=>{
      if(status==='SUBSCRIBED'){
        reconnectAttempt=0
        if(reconnectTimer!==null){window.clearTimeout(reconnectTimer);reconnectTimer=null}
        setSyncStatus('connected')
        void refreshLocationState({force:true})
        return
      }
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
        scheduleReconnect()
      }
    })
}

export function subscribeLocationState(listener:Listener){
  listeners.add(listener)
  startRealtime()
  listener(getLocationState())
  if(!state.updatedAt&&!state.loading)void refreshLocationState()
  return ()=>{
    listeners.delete(listener)
    if(!listeners.size){
      if(reconnectTimer!==null){window.clearTimeout(reconnectTimer);reconnectTimer=null}
      teardownRealtime()
    }
  }
}

export async function refreshLocationState(options:{force?:boolean}={}):Promise<LocationState>{
  const force=!!options.force
  if(inflight)return inflight
  if(!force&&state.updatedAt&&Date.now()-state.updatedAt<CACHE_TTL_MS)return getLocationState()

  state={...state,loading:true,error:null}
  publish()

  inflight=(async()=>{
    try{
      const [membersResult,locationsResult,profilesResult]=await Promise.all([
        supabase.from('family_members').select('id,name,active,must_share_location').eq('active',true).order('created_at'),
        supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at').order('updated_at',{ascending:false}),
        supabase.from('family_profiles').select('member_id,avatar_path'),
      ])
      if(membersResult.error)throw membersResult.error
      if(locationsResult.error)throw locationsResult.error

      const members=((membersResult.data||[]) as LocationMember[]).filter(member=>member.active!==false)
      const memberIds=new Set(members.map(member=>member.id))
      const locations=((locationsResult.data||[]) as FamilyLocation[])
        .filter(row=>memberIds.has(row.member_id)&&validCoordinate(row))
      const profiles=profilesResult.error
        ? state.profiles
        : ((profilesResult.data||[]) as LocationProfile[]).filter(profile=>memberIds.has(profile.member_id))

      state={
        members,
        locations,
        profiles,
        loading:false,
        error:null,
        updatedAt:Date.now(),
        revision:state.revision+1,
        syncStatus:navigator.onLine?'connected':'offline',
      }
      publish()
      return getLocationState()
    }catch(error){
      console.error('Family location state refresh failed',error)
      state={
        ...state,
        loading:false,
        error:error instanceof Error?error.message:'LOCATION_REFRESH_FAILED',
        revision:state.revision+1,
        syncStatus:navigator.onLine?state.syncStatus:'offline',
      }
      publish()
      if(navigator.onLine)scheduleReconnect()
      return getLocationState()
    }finally{
      inflight=null
    }
  })()

  return inflight
}

export async function saveOwnLocation(input:{
  memberId:string
  latitude:number
  longitude:number
  accuracy:number|null
}){
  const {error}=await supabase.from('locations').upsert({
    member_id:input.memberId,
    latitude:input.latitude,
    longitude:input.longitude,
    accuracy:input.accuracy,
    updated_at:new Date().toISOString(),
  },{onConflict:'member_id'})
  if(error)throw error
  return refreshLocationState({force:true})
}

export async function stopSharingOwnLocation(){
  const {error}=await supabase.rpc('stop_sharing_family_location')
  if(error)throw error
  return refreshLocationState({force:true})
}

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&listeners.size){
    startRealtime()
    void refreshLocationState({force:true})
  }
})

window.addEventListener('online',()=>{
  setSyncStatus('reconnecting')
  if(reconnectTimer!==null){window.clearTimeout(reconnectTimer);reconnectTimer=null}
  teardownRealtime()
  startRealtime()
  if(listeners.size)void refreshLocationState({force:true})
})

window.addEventListener('offline',()=>{
  if(reconnectTimer!==null){window.clearTimeout(reconnectTimer);reconnectTimer=null}
  teardownRealtime()
  setSyncStatus('offline')
})

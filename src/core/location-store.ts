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

// Only current, sufficiently precise points are eligible for the live map.
// A server row is NOT proof that the family member is still there after this
// window. Keep older coordinates in storage for controlled retention only.
export const LIVE_LOCATION_WINDOW_MS=75_000
export const MAX_LIVE_ACCURACY_M=65
// A recent server-confirmed point can stay visible across app reopen/resume.
// Positions still expire automatically after the freshness window.
export function isLiveFamilyLocation(updatedAt:string, now=Date.now()){
  const age=now-Date.parse(updatedAt)
  return Number.isFinite(age)&&age>=-15_000&&age<LIVE_LOCATION_WINDOW_MS
}
const PENDING_STOP_KEY='familia-noa-gps-stop-pending-v1'
const ACTIVATION_KEY='familia-noa-gps-activation-v1'

// A voluntary OFF action must conceal this phone's former marker immediately,
// even if the network is unavailable or a refresh races the server deletion.
function locationAllowedByLocalConsent(row:FamilyLocation){
  try{
    const stop=JSON.parse(localStorage.getItem(PENDING_STOP_KEY)||'null')
    if(stop?.memberId===row.member_id)return false
    const activation=JSON.parse(localStorage.getItem(ACTIVATION_KEY)||'null')
    if(activation?.memberId===row.member_id && Number.isFinite(activation?.at) &&
       Date.parse(row.updated_at)<activation.at-3_000)return false
  }catch{}
  return true
}

export function notifyFamilyLocationPrivacyChanged(){
  publish()
}

export function isCurrentFamilyLocation(row:FamilyLocation, now=Date.now()){
  return locationAllowedByLocalConsent(row)&&isLiveFamilyLocation(row.updated_at,now)&&
    typeof row.accuracy==='number'&&Number.isFinite(row.accuracy)&&
    row.accuracy>=0&&row.accuracy<=MAX_LIVE_ACCURACY_M&&
    Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)&&
    row.latitude>=-90&&row.latitude<=90&&row.longitude>=-180&&row.longitude<=180
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
// Realtime is authoritative for the moving marker. A slower REST refresh
// must not overwrite a newer event or resurrect a row just deleted.
const REALTIME_RECONCILE_MS=12_000
let realtimeSequence=0
const realtimeMutations=new Map<string,{
  sequence:number
  location:FamilyLocation|null
}>()

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

// Supabase Realtime delivers the server-confirmed row in the UPDATE/INSERT.
// Render that row immediately, rather than waiting for three parallel REST
// queries (members, locations and photos) just to position one marker.
// The scheduled refresh below still reconciles membership and missed events.
function showRealtimeLocationChange(event:{
  eventType:string
  new:Record<string,unknown>
  old:Record<string,unknown>
}){
  if(event.eventType==='DELETE'){
    const id=event.old?.member_id
    if(typeof id!=='string'||!id)return
    realtimeMutations.set(id,{sequence:++realtimeSequence,location:null})
    if(!state.locations.some(row=>row.member_id===id))return
    state={
      ...state,
      locations:state.locations.filter(row=>row.member_id!==id),
      revision:state.revision+1,
    }
    publish()
    return
  }
  const data=event.new
  if(!data||typeof data.member_id!=='string'||typeof data.latitude!=='number'||
    typeof data.longitude!=='number'||typeof data.updated_at!=='string')return
  if(data.accuracy!==null&&typeof data.accuracy!=='number')return
  const incoming:FamilyLocation={
    member_id:data.member_id,latitude:data.latitude,longitude:data.longitude,
    accuracy:typeof data.accuracy==='number'?data.accuracy:null,
    updated_at:data.updated_at,
  }
  if(!validCoordinate(incoming)||!Number.isFinite(Date.parse(incoming.updated_at)))return
  const existing=state.locations.find(row=>row.member_id===incoming.member_id)
  if(existing&&Date.parse(existing.updated_at)>Date.parse(incoming.updated_at))return
  realtimeMutations.set(incoming.member_id,{
    sequence:++realtimeSequence,location:incoming,
  })
  // Before the initial family membership fetch, retain the verified event
  // for reconciliation rather than exposing an unidentified member on screen.
  if(!state.members.some(member=>member.id===incoming.member_id))return
  state={
    ...state,
    locations:[...state.locations.filter(row=>row.member_id!==incoming.member_id),incoming],
    revision:state.revision+1,
  }
  publish()
}

function onRealtimeLocationChange(event:{
  eventType:string
  new:Record<string,unknown>
  old:Record<string,unknown>
}){
  showRealtimeLocationChange(event)
  // Each Realtime change already carries the server row. A full triple-table
  // reload for every GPS sample slows the WebView and can race newer events.
  // Keep occasional reconciliation for dropped events or changing profiles.
  if(!state.updatedAt||Date.now()-state.updatedAt>=REALTIME_RECONCILE_MS){
    scheduleRealtimeRefresh()
  }
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
    .on('postgres_changes',{event:'*',schema:'public',table:'locations'},onRealtimeLocationChange)
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

  const realtimeAtRequestStart=realtimeSequence
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
      const serverLocations=((locationsResult.data||[]) as FamilyLocation[])
        .filter(row=>memberIds.has(row.member_id)&&validCoordinate(row))
      const byMember=new Map(serverLocations.map(row=>[row.member_id,row]))
      // Merge Realtime events that arrived while the REST request was in
      // flight. Older REST responses must never move a family member back.
      for(const [memberId,mutation] of realtimeMutations){
        if(!memberIds.has(memberId))continue
        if(mutation.location===null){
          if(mutation.sequence>realtimeAtRequestStart)byMember.delete(memberId)
          continue
        }
        const fetched=byMember.get(memberId)
        const newerThanRest=!fetched||
          Date.parse(mutation.location.updated_at)>Date.parse(fetched.updated_at)
        if((mutation.sequence>realtimeAtRequestStart||fetched)&&newerThanRest){
          byMember.set(memberId,mutation.location)
        }
      }
      const locations=[...byMember.values()]
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

window.addEventListener('familia-noa:android-resumed',()=>{
  if(!listeners.size)return
  void refreshLocationState({force:true})
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

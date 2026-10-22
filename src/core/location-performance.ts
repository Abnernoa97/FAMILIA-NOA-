/**
 * Local-only, short-lived GPS/PWA timing diagnostics.
 *
 * Never records member names, coordinates, tokens or messages in a report.
 * Does not write to network, localStorage, analytics, or Supabase.
 * A small runtime map uses member ID solely to match a Realtime event to
 * its own marker; it is not exposed by getFamilyGpsDiagnostics().
 *
 * "serverAgeMs" is an estimate that includes device/server clock skew.
 * "renderDelayMs" is measured with performance.now(), from arrival in the
 * WebView until the following browser paint opportunity.
 */
type Source='realtime'|'snapshot'
type Arrival={
  updatedAt:string
  source:Source
  receivedAt:number
  serverAgeMs:number|null
}
type Sample={
  source:Source
  renderDelayMs:number
  serverAgeMs:number|null
}
const arrivals=new Map<string,Arrival>()
const painted=new Set<string>()
const scheduled=new Set<string>()
const samples:Sample[]=[]
let viewStartedAt:number|null=null
let lastMapReadyMs:number|null=null

function rounded(value:number){
  return Math.max(0,Math.round(value))
}
function percentile(values:number[],part:number):number|null{
  if(!values.length)return null
  const ordered=[...values].sort((a,b)=>a-b)
  return ordered[Math.min(ordered.length-1,Math.ceil(ordered.length*part)-1)]
}

export function noteFamilyLocationArrived(memberId:string,updatedAt:string,source:Source){
  if(!memberId||!updatedAt)return
  const timestamp=Date.parse(updatedAt)
  if(!Number.isFinite(timestamp))return
  const existing=arrivals.get(memberId)
  if(existing&&Date.parse(existing.updatedAt)>timestamp)return
  if(existing&&existing.updatedAt===updatedAt){
    // Preserve the first, fastest Realtime arrival against later REST reloads.
    return
  }
  const approximateAge=Date.now()-timestamp
  arrivals.set(memberId,{
    updatedAt,
    source,
    receivedAt:performance.now(),
    serverAgeMs:approximateAge>=-15_000&&approximateAge<=600_000?rounded(approximateAge):null,
  })
  // Bound transient runtime memory for a potentially changing family group.
  if(arrivals.size>32){
    const oldest=arrivals.keys().next().value
    if(oldest)arrivals.delete(oldest)
  }
}

export function forgetFamilyLocationTiming(memberId:string){
  arrivals.delete(memberId)
}

export function noteFamilyMarkerUpdated(memberId:string,updatedAt:string){
  if(document.hidden)return
  const arrival=arrivals.get(memberId)
  if(!arrival||arrival.updatedAt!==updatedAt)return
  const key=memberId+':'+updatedAt
  if(painted.has(key)||scheduled.has(key))return
  scheduled.add(key)
  // Two frames account for the marker DOM update and next visible frame.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    scheduled.delete(key)
    if(document.hidden)return
    const current=arrivals.get(memberId)
    if(!current||current.updatedAt!==updatedAt)return
    if(painted.has(key))return
    painted.add(key)
    if(painted.size>80){
      const oldest=painted.values().next().value
      if(oldest)painted.delete(oldest)
    }
    const delay=performance.now()-current.receivedAt
    if(!Number.isFinite(delay)||delay<0||delay>120_000)return
    samples.push({
      source:current.source,
      renderDelayMs:rounded(delay),
      serverAgeMs:current.serverAgeMs,
    })
    if(samples.length>32)samples.shift()
  }))
}

export function noteFamilyMapOpened(){
  viewStartedAt=performance.now()
  lastMapReadyMs=null
}
export function noteFamilyMapReady(){
  if(viewStartedAt!==null&&lastMapReadyMs===null){
    lastMapReadyMs=rounded(performance.now()-viewStartedAt)
  }
}

export function getFamilyGpsDiagnostics(){
  const rendered=samples.map(item=>item.renderDelayMs)
  const estimatedAge=samples.map(item=>item.serverAgeMs).filter((age):age is number=>age!==null)
  const realtime=samples.filter(item=>item.source==='realtime').length
  return {
    description:'PWA local timing; no GPS coordinates or family identifiers',
    samples:samples.length,
    realtimeSamples:realtime,
    snapshotSamples:samples.length-realtime,
    browserEventToPaintMedianMs:percentile(rendered,0.5),
    browserEventToPaintP95Ms:percentile(rendered,0.95),
    approximatePositionAgeAtReceptionMedianMs:percentile(estimatedAge,0.5),
    timeFromMapOpenUntilStyleLoadedMs:lastMapReadyMs,
    // A missing sample is unknown, never a zero-second claim.
  }
}

// Support inspection only when requested; adds no visual elements and sends
// no data anywhere. The returned object deliberately contains no coordinates.
;(window as Window & {
  familiaNoaGpsDiagnostico? : ()=>ReturnType<typeof getFamilyGpsDiagnostics>
}).familiaNoaGpsDiagnostico=getFamilyGpsDiagnostics

import { getIdentity } from './core/identity'
import { getLocationState, refreshLocationState, stopSharingOwnLocation, subscribeLocationState, type LocationState } from './core/location-store'

const STALE_AFTER_MS=60*60*1000

let observer:MutationObserver|null=null
let busy=false
let scheduled:number|null=null
let periodicTimer:number|null=null
let stateUnsubscribe:(()=>void)|null=null
let latestState=getLocationState()

function injectStyles(){
  if(document.querySelector('#location-privacy-css'))return
  const style=document.createElement('style')
  style.id='location-privacy-css'
  style.textContent=`
  .location-stop-share{width:100%;margin-top:10px;padding:14px 16px;border:1px solid #ddd8ce;border-radius:16px;background:transparent;color:#6f6b63;font-weight:700}
  .location-stop-share:disabled{opacity:.5;cursor:wait}
  .location-privacy-note{margin:10px 16px 0;padding:11px 13px;border:1px solid #e5dfd4;border-radius:14px;background:#f8f5ef;color:#79746c;font-size:11px;line-height:1.45}
  .locationrow.stale{opacity:.72;border-style:dashed;background:#faf8f3}
  .locationrow.stale .location-dot{opacity:.55}
  .family-map-marker.location-stale .family-map-marker-dot{opacity:.58;filter:grayscale(.35)}
  .family-map-marker.location-stale .family-map-marker-label{background:rgba(92,86,77,.86)}
  .family-map-chip.location-stale{opacity:.68}
  `
  document.head.appendChild(style)
}

function isOptionalLocationPage(page:HTMLElement){
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  const title=page.querySelector<HTMLElement>('.locationbox h2')?.textContent?.trim().toLowerCase()||''
  return !gated&&title==='compartir ubicación'
}

function rowName(row:HTMLElement){
  return (row.querySelector('b')?.textContent||'').replace(/\s*·\s*tú\s*$/i,'').trim()
}

function chipName(chip:HTMLElement){
  const textNode=[...chip.childNodes].reverse().find(node=>node.nodeType===Node.TEXT_NODE)
  return (textNode?.textContent||'').trim()
}

function ensurePrivacyNote(page:HTMLElement){
  if(page.querySelector('[data-location-privacy-note]'))return
  const box=page.querySelector<HTMLElement>('.locationbox')
  if(!box)return
  const note=document.createElement('div')
  note.className='location-privacy-note'
  note.dataset.locationPrivacyNote='1'
  note.textContent='La app no rastrea en segundo plano. Se muestra la última ubicación compartida y cuándo fue actualizada.'
  box.insertAdjacentElement('afterend',note)
}

function staleNameSet(state:LocationState){
  const names=new Map(state.members.map(member=>[member.id,member.name]))
  return new Set(
    state.locations
      .filter(location=>{
        const updated=new Date(location.updated_at).getTime()
        return Number.isFinite(updated)&&Date.now()-updated>STALE_AFTER_MS
      })
      .map(location=>names.get(location.member_id)||'')
      .filter(Boolean)
  )
}

function applyFreshness(page:HTMLElement,state:LocationState){
  const names=new Map(state.members.map(member=>[member.id,member.name]))
  const locationByName=new Map(
    state.locations.map(location=>[names.get(location.member_id)||'',location])
  )
  const staleNames=staleNameSet(state)

  page.querySelectorAll<HTMLElement>('.locationrow').forEach(row=>{
    if(row.classList.contains('locationrow-empty'))return
    const name=rowName(row)
    const location=locationByName.get(name)
    const updated=location?new Date(location.updated_at).getTime():NaN
    const stale=Number.isFinite(updated)&&Date.now()-updated>STALE_AFTER_MS
    row.classList.toggle('stale',stale)
    row.dataset.locationFreshness=stale?'stale':'fresh'
    const small=row.querySelector<HTMLElement>('small')
    if(small){
      const clean=(small.textContent||'').replace(/^Última ubicación\s*·\s*/i,'')
      const next=stale?`Última ubicación · ${clean}`:clean
      if(small.textContent!==next)small.textContent=next
      small.dataset.staleLabel=stale?'1':'0'
    }
  })

  page.querySelectorAll<HTMLElement>('.family-map-marker').forEach(marker=>{
    const label=marker.querySelector<HTMLElement>('.family-map-marker-label')
    const name=(label?.textContent||'').replace(/\s*·\s*última\s*$/i,'').trim()
    const stale=staleNames.has(name)
    marker.classList.toggle('location-stale',stale)
    if(label){
      const next=stale?`${name} · última`:name
      if(label.textContent!==next)label.textContent=next
    }
  })

  page.querySelectorAll<HTMLElement>('.family-map-chip').forEach(chip=>{
    chip.classList.toggle('location-stale',staleNames.has(chipName(chip)))
  })
}

function syncStopButton(page:HTMLElement,state:LocationState){
  const existing=page.querySelector<HTMLButtonElement>('[data-stop-location]')
  if(!isOptionalLocationPage(page)){
    existing?.remove()
    return
  }

  const identity=getIdentity()
  const sharing=!!identity?.memberId&&state.locations.some(location=>location.member_id===identity.memberId)
  if(!sharing){
    existing?.remove()
    return
  }
  if(existing)return

  const primary=page.querySelector<HTMLButtonElement>('#sharelocation')
  if(!primary)return
  const button=document.createElement('button')
  button.type='button'
  button.className='location-stop-share'
  button.dataset.stopLocation='1'
  button.textContent='Dejar de compartir ubicación'
  primary.insertAdjacentElement('afterend',button)

  button.addEventListener('click',()=>{
    if(busy)return
    void(async()=>{
      busy=true
      button.disabled=true
      button.textContent='Dejando de compartir…'
      try{
        if(!getIdentity()?.memberId)throw new Error('FAMILY_SESSION_REQUIRED')
        await stopSharingOwnLocation()
        const text=page.querySelector<HTMLElement>('#locationtext')
        if(text)text.textContent='Ya no compartes tu ubicación con la familia.'
        button.remove()
      }catch(error){
        console.error('Stop family location sharing failed',error)
        button.disabled=false
        button.textContent='Dejar de compartir ubicación'
        const text=page.querySelector<HTMLElement>('#locationtext')
        if(text)text.textContent='No se pudo dejar de compartir la ubicación. Inténtalo de nuevo.'
      }finally{
        busy=false
      }
    })()
  })
}

function enhance(){
  scheduled=null
  const page=document.querySelector<HTMLElement>('.location-page')
  if(!page)return
  ensurePrivacyNote(page)
  applyFreshness(page,latestState)
  syncStopButton(page,latestState)
}

function schedule(){
  if(scheduled!==null)return
  scheduled=window.setTimeout(enhance,60)
}

injectStyles()
observer=new MutationObserver(schedule)
observer.observe(document.body,{childList:true,subtree:true})
stateUnsubscribe=subscribeLocationState(state=>{
  latestState=state
  schedule()
})
periodicTimer=window.setInterval(()=>{
  if(document.querySelector('.location-page'))schedule()
},60*1000)
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&document.querySelector('.location-page')){
    void refreshLocationState({force:true})
    schedule()
  }
})
window.addEventListener('beforeunload',()=>{
  observer?.disconnect()
  observer=null
  stateUnsubscribe?.()
  stateUnsubscribe=null
  if(scheduled!==null)window.clearTimeout(scheduled)
  if(periodicTimer!==null)window.clearInterval(periodicTimer)
},{once:true})
schedule()

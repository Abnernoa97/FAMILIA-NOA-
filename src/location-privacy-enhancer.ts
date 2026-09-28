import { supabase } from './supabase'
import { getIdentity } from './core/identity'

const STALE_AFTER_MS=60*60*1000
const FRESHNESS_FETCH_TTL_MS=30*1000

let observer:MutationObserver|null=null
let busy=false
let scheduled:number|null=null
let freshnessLoading=false
let lastFreshnessFetch=0
let periodicTimer:number|null=null
const updatedByName=new Map<string,number>()

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

function ownLocationRow(page:HTMLElement){
  return [...page.querySelectorAll<HTMLElement>('.locationrow')].find(row=>
    row.querySelector('b')?.textContent?.includes('· tú')
  )||null
}

function rowName(row:HTMLElement){
  return (row.querySelector('b')?.textContent||'').replace(/\s*·\s*tú\s*$/i,'').trim()
}

function staleNames(page:HTMLElement){
  return new Set(
    [...page.querySelectorAll<HTMLElement>('.locationrow.stale')]
      .map(row=>rowName(row))
      .filter(Boolean)
  )
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

function applyFreshness(page:HTMLElement){
  page.querySelectorAll<HTMLElement>('.locationrow').forEach(row=>{
    if(row.classList.contains('locationrow-empty'))return
    const name=rowName(row)
    const updated=updatedByName.get(name)
    const stale=typeof updated==='number'&&Number.isFinite(updated)?Date.now()-updated>STALE_AFTER_MS:row.classList.contains('stale')
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

  const stale=staleNames(page)
  page.querySelectorAll<HTMLElement>('.family-map-marker').forEach(marker=>{
    const label=marker.querySelector<HTMLElement>('.family-map-marker-label')
    const name=(label?.textContent||'').replace(/\s*·\s*última\s*$/i,'').trim()
    const isStale=stale.has(name)
    marker.classList.toggle('location-stale',isStale)
    if(label){
      const next=isStale?`${name} · última`:name
      if(label.textContent!==next)label.textContent=next
    }
  })

  page.querySelectorAll<HTMLElement>('.family-map-chip').forEach(chip=>{
    chip.classList.toggle('location-stale',stale.has(chipName(chip)))
  })

  const mapTitle=page.querySelector<HTMLElement>('[data-family-map] .family-map-head b')
  if(mapTitle&&mapTitle.textContent!=='Últimas ubicaciones')mapTitle.textContent='Últimas ubicaciones'
  const listTitle=page.querySelector<HTMLElement>('.location-section-title span')
  if(listTitle&&listTitle.textContent!=='Se actualiza cuando alguien comparte')listTitle.textContent='Se actualiza cuando alguien comparte'
}

async function refreshFreshness(force=false){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(!page||freshnessLoading||!getIdentity()?.memberId)return
  if(!force&&Date.now()-lastFreshnessFetch<FRESHNESS_FETCH_TTL_MS){applyFreshness(page);return}
  freshnessLoading=true
  try{
    const [membersResult,locationsResult]=await Promise.all([
      supabase.from('family_members').select('id,name,active').eq('active',true),
      supabase.from('locations').select('member_id,updated_at')
    ])
    if(membersResult.error)throw membersResult.error
    if(locationsResult.error)throw locationsResult.error
    const names=new Map((membersResult.data||[]).map((member:any)=>[String(member.id),String(member.name||'')]))
    updatedByName.clear()
    ;(locationsResult.data||[]).forEach((row:any)=>{
      const name=names.get(String(row.member_id))
      const time=new Date(String(row.updated_at||'')).getTime()
      if(name&&Number.isFinite(time))updatedByName.set(name,time)
    })
    lastFreshnessFetch=Date.now()
  }catch(error){
    console.warn('Location freshness check failed',error)
  }finally{
    freshnessLoading=false
    const current=document.querySelector<HTMLElement>('.location-page')
    if(current)applyFreshness(current)
  }
}

function syncStopButton(page:HTMLElement){
  const existing=page.querySelector<HTMLButtonElement>('[data-stop-location]')
  if(!isOptionalLocationPage(page)){
    existing?.remove()
    return
  }

  const row=ownLocationRow(page)
  const sharing=!!row&&!row.classList.contains('locationrow-empty')&&!!row.querySelector('a')
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
        const identity=getIdentity()
        if(!identity?.memberId)throw new Error('FAMILY_SESSION_REQUIRED')
        const {error}=await supabase.rpc('stop_sharing_family_location')
        if(error)throw error
        const text=page.querySelector<HTMLElement>('#locationtext')
        if(text)text.textContent='Ya no compartes tu ubicación con la familia.'
        button.remove()
        lastFreshnessFetch=0
        void refreshFreshness(true)
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
  applyFreshness(page)
  syncStopButton(page)
  void refreshFreshness()
}

function schedule(){
  if(scheduled!==null)return
  scheduled=window.setTimeout(enhance,80)
}

injectStyles()
observer=new MutationObserver(schedule)
observer.observe(document.body,{childList:true,subtree:true})
periodicTimer=window.setInterval(()=>{if(document.querySelector('.location-page')){lastFreshnessFetch=0;schedule()}},60*1000)
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.querySelector('.location-page')){lastFreshnessFetch=0;schedule()}})
window.addEventListener('beforeunload',()=>{
  observer?.disconnect()
  observer=null
  if(scheduled!==null)window.clearTimeout(scheduled)
  if(periodicTimer!==null)window.clearInterval(periodicTimer)
},{once:true})
schedule()

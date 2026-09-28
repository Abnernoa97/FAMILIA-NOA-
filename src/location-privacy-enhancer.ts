import { supabase } from './supabase'
import { getIdentity } from './core/identity'

let observer:MutationObserver|null=null
let busy=false
let scheduled:number|null=null

function injectStyles(){
  if(document.querySelector('#location-privacy-css'))return
  const style=document.createElement('style')
  style.id='location-privacy-css'
  style.textContent=`
  .location-stop-share{width:100%;margin-top:10px;padding:14px 16px;border:1px solid #ddd8ce;border-radius:16px;background:transparent;color:#6f6b63;font-weight:700}
  .location-stop-share:disabled{opacity:.5;cursor:wait}
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

function staleNames(page:HTMLElement){
  return new Set(
    [...page.querySelectorAll<HTMLElement>('.locationrow.stale b')]
      .map(node=>(node.textContent||'').replace(/\s*·\s*tú\s*$/i,'').trim())
      .filter(Boolean)
  )
}

function chipName(chip:HTMLElement){
  const textNode=[...chip.childNodes].reverse().find(node=>node.nodeType===Node.TEXT_NODE)
  return (textNode?.textContent||'').trim()
}

function decorateStaleState(page:HTMLElement){
  page.querySelectorAll<HTMLElement>('.locationrow.stale small').forEach(small=>{
    if(small.dataset.staleLabel==='1')return
    small.dataset.staleLabel='1'
    small.textContent=`Última ubicación · ${small.textContent||''}`
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
  decorateStaleState(page)
  syncStopButton(page)
}

function schedule(){
  if(scheduled!==null)return
  scheduled=window.setTimeout(enhance,80)
}

injectStyles()
observer=new MutationObserver(schedule)
observer.observe(document.body,{childList:true,subtree:true})
schedule()
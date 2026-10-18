import { getIdentity } from './core/identity'
import { getLocationState, isLocationLive, refreshLocationState, stopSharingOwnLocation, subscribeLocationState, type LocationState } from './core/location-store'

const STALE_AFTER_MS=60*60*1000

let observer:MutationObserver|null=null
let busy=false
let scheduled:number|null=null
let periodicTimer:number|null=null
let stateUnsubscribe:(()=>void)|null=null
let latestState=getLocationState()
let observedPage:HTMLElement|null=null

function setText(element:HTMLElement|null|undefined,value:string){
  if(element&&element.textContent!==value)element.textContent=value
}

function setHtml(element:HTMLElement|null|undefined,value:string){
  if(element&&element.innerHTML!==value)element.innerHTML=value
}

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
  .location-sharing-active .locationbox{padding:20px 20px 18px;margin-top:14px;border-radius:22px;box-shadow:0 12px 32px rgba(35,31,25,.06)}
  .location-sharing-active .locationbox .pin{font-size:28px;margin-bottom:8px}
  .location-sharing-active .locationbox h2{font-size:27px;margin-bottom:5px}
  .location-sharing-active .locationbox p{margin:0;color:#79746c;font-size:13px}
  .location-sharing-active .locationbox .primary{margin-top:14px}
  .location-share-status{display:inline-flex;align-items:center;gap:7px;margin:0 0 10px;padding:6px 9px;border-radius:999px;background:#eef6ef;color:#2f6d45;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
  .location-share-status i{width:7px;height:7px;border-radius:50%;background:#48a06a;box-shadow:0 0 0 4px rgba(72,160,106,.11)}
  .location-sync-note{display:flex;align-items:center;gap:7px;margin:8px 16px 0;padding:8px 11px;border-radius:13px;background:#efeae1;color:#756f67;font-size:10px}
  .location-sync-note[data-status="connected"]{background:#eef6ef;color:#38634a}
  .location-sync-note[data-status="offline"]{background:#f6ece8;color:#8a5145}
  `
  document.head.appendChild(style)
}

function isOptionalLocationPage(page:HTMLElement){
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  return !gated&&!!page.querySelector('#back')
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
  note.textContent='La ubicación en vivo se actualiza mientras FAMILIA NOA siga activa. Si Android la suspende, deja de mostrarse EN VIVO automáticamente.'
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

function locationAgeShort(value:string){
  const ms=Date.now()-new Date(value).getTime()
  if(!Number.isFinite(ms)||ms<60000)return 'Ahora'
  const minutes=Math.floor(ms/60000)
  if(minutes<60)return `Hace ${minutes} min`
  const hours=Math.floor(minutes/60)
  if(hours<24)return `Hace ${hours} h`
  const days=Math.floor(hours/24)
  return `Hace ${days} día${days===1?'':'s'}`
}

function syncOwnSharingCard(page:HTMLElement,state:LocationState){
  if(!isOptionalLocationPage(page))return
  const identity=getIdentity()
  const mine=identity?.memberId?state.locations.find(location=>location.member_id===identity.memberId):null
  const box=page.querySelector<HTMLElement>('.locationbox')
  const title=box?.querySelector<HTMLElement>('h2')
  const text=page.querySelector<HTMLElement>('#locationtext')
  let badge=box?.querySelector<HTMLElement>('[data-location-share-status]')||null

  if(mine){
    const live=isLocationLive(mine)
    page.classList.add('location-sharing-active')
    if(!badge&&box){
      badge=document.createElement('span')
      badge.className='location-share-status'
      badge.dataset.locationShareStatus='1'
      badge.innerHTML=`<i></i> ${live?'EN VIVO':'Compartiendo'}`
      box.querySelector('.pin')?.insertAdjacentElement('afterend',badge)
    }
    setHtml(badge,`<i></i> ${live?'EN VIVO':'Compartiendo'}`)
    setText(title,live?'Ubicación en vivo':'Compartiendo ahora')
    const accuracy=Number.isFinite(mine.accuracy)?` · ±${Math.round(mine.accuracy as number)} m`:''
    setText(text,live
      ?`Actualizando automáticamente · ${locationAgeShort(mine.updated_at)}${accuracy}`
      :`${locationAgeShort(mine.updated_at)}${accuracy}`)
  }else{
    page.classList.remove('location-sharing-active')
    badge?.remove()
    setText(title,'Compartir ubicación')
    if(text&&!text.textContent?.includes('No se pudo'))setText(text,'Comparte tu ubicación con la familia cuando quieras.')
  }

  let sync=page.querySelector<HTMLElement>('[data-location-sync-note]')
  if(!sync){
    sync=document.createElement('div')
    sync.className='location-sync-note'
    sync.dataset.locationSyncNote='1'
    box?.insertAdjacentElement('afterend',sync)
  }
  if(sync){
    sync.dataset.status=state.syncStatus
    setText(sync,state.syncStatus==='offline'
      ? 'Sin conexión · mostrando la última ubicación guardada'
      : state.syncStatus==='reconnecting'
        ? 'Reconectando ubicación…'
        : state.syncStatus==='connecting'
          ? 'Conectando ubicación…'
          : 'Ubicación sincronizada con la familia')
  }
}

function syncStopButton(page:HTMLElement,state:LocationState){
  const existing=page.querySelector<HTMLButtonElement>('[data-stop-location]')
  if(!isOptionalLocationPage(page)){
    existing?.remove()
    return
  }

  const identity=getIdentity()
  const mine=identity?.memberId?state.locations.find(location=>location.member_id===identity.memberId):null
  const live=!!mine&&isLocationLive(mine)
  if(live){
    existing?.remove()
    return
  }
  const sharing=!!mine
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
  syncOwnSharingCard(page,latestState)
  applyFreshness(page,latestState)
  syncStopButton(page,latestState)
}

function schedule(){
  if(scheduled!==null)return
  scheduled=window.setTimeout(enhance,60)
}

function scanPage(){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(page===observedPage)return
  observedPage=page
  schedule()
}

injectStyles()
observer=new MutationObserver(scanPage)
observer.observe(document.body,{childList:true,subtree:true})
stateUnsubscribe=subscribeLocationState(state=>{
  latestState=state
  schedule()
})
scanPage()
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

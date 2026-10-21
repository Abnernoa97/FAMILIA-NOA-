import { getMemberId } from './core/identity'
import { mediaUrl, primeMedia } from './core/private-media'
import { getLocationState, refreshLocationState, subscribeLocationState, isCurrentFamilyLocation, type LocationState } from './core/location-store'
import { hasNativeLocationCapability, isDeviceLocationEnabled, refreshMemberLocation } from './core/location-device-sync'

const MAPLIBRE_JS='https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs'
const MAPLIBRE_CSS='https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.css'
const MAP_STYLE='https://tiles.openfreemap.org/styles/liberty'
const VECTOR_SOURCE='https://tiles.openfreemap.org/planet'

type MapLocation={
  member_id:string
  latitude:number
  longitude:number
  accuracy:number|null
  updated_at:string
  name:string
  mine:boolean
  avatarPath:string|null
  avatarUrl:string
}

let maplibrePromise:Promise<any>|null=null
let map:any=null
let markers=new Map<string,any>()
let mapLoaded=false
let selectedLiveMemberId=''
let focusGeneration=0
let activePopup:any=null
let activePopupMemberId=''
let currentLocations:MapLocation[]=[]
let lastLocationSignature=''
let activePage:Element|null=null
let pageObserver:MutationObserver|null=null
let stateUnsubscribe:(()=>void)|null=null
let resizeObserver:ResizeObserver|null=null
let generation=0
let liveRefreshTimer:number|null=null
let pendingFocusMemberId=''

function esc(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))}
function initial(item:MapLocation){return item.name.charAt(0).toUpperCase()||'•'}
function avatarMarkup(item:MapLocation){
  if(!item.avatarUrl)return esc(initial(item))
  return `<img src="${esc(item.avatarUrl)}" alt="" decoding="async" draggable="false" data-avatar-fallback="${esc(initial(item))}">`
}
function bindAvatarFallback(root:ParentNode){
  root.querySelectorAll<HTMLImageElement>('img[data-avatar-fallback]').forEach(img=>{
    img.addEventListener('error',()=>{
      const host=img.parentElement
      if(host)host.textContent=img.dataset.avatarFallback||'•'
    },{once:true})
  })
}
function age(value:string){
  const ms=Date.now()-new Date(value).getTime()
  if(!Number.isFinite(ms)||ms<60000)return 'Ahora'
  const minutes=Math.floor(ms/60000)
  if(minutes<60)return `Hace ${minutes} min`
  const hours=Math.floor(minutes/60)
  if(hours<24)return `Hace ${hours} h`
  const days=Math.floor(hours/24)
  return `Hace ${days} día${days===1?'':'s'}`
}

function ensureAssets(){
  if(!document.querySelector('link[data-family-maplibre]')){
    const link=document.createElement('link')
    link.rel='stylesheet'
    link.href=MAPLIBRE_CSS
    link.dataset.familyMaplibre='true'
    document.head.appendChild(link)
  }
  if(document.getElementById('family-map-styles'))return
  const style=document.createElement('style')
  style.id='family-map-styles'
  style.textContent=`
  .family-map-shell{position:relative;height:var(--family-map-dynamic-height,min(52dvh,560px));min-height:310px;margin:14px 16px 18px;border-radius:32px;overflow:hidden;background:#ddd8ce;border:1px solid rgba(218,211,198,.9);box-shadow:0 22px 56px rgba(35,31,25,.14);isolation:isolate}.family-map-canvas{position:absolute;inset:0}.family-map-canvas .maplibregl-canvas{outline:none}.family-map-shell::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(12,12,12,.16),transparent 28%,transparent 62%,rgba(12,12,12,.14));z-index:2}
  .family-map-head{position:absolute;left:14px;right:14px;top:14px;z-index:4;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;pointer-events:none}.family-map-head>div{padding:10px 13px;border-radius:18px;background:rgba(250,248,242,.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 6px 22px #0001}.family-map-head small{display:block;font-size:8.5px;letter-spacing:.16em;font-weight:800;color:#77736b}.family-map-head b{display:block;margin-top:2px;font:500 19px var(--display-font,Georgia,serif);color:#171716}.family-map-actions{display:flex;gap:7px;pointer-events:auto}.family-map-all,.family-map-mine{height:42px;padding:0 14px;border:0;border-radius:21px;font-weight:750;font-size:11px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 6px 18px #0002}.family-map-all{background:rgba(23,23,22,.92);color:#fff}.family-map-mine{background:rgba(250,248,242,.92);color:#171716}
  .family-map-people{position:absolute;z-index:5;top:86px;left:12px;right:12px;display:flex;align-items:center;gap:6px;overflow-x:auto;scrollbar-width:none;padding:3px 0 5px;touch-action:pan-x;overscroll-behavior-x:contain}
  .family-map-people::-webkit-scrollbar{display:none}
  .family-map-people[hidden]{display:none!important}
  .family-map-name-pill{flex:0 0 auto;min-height:30px;max-width:180px;display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border:1px solid rgba(255,255,255,.18);border-radius:99px;background:rgba(18,18,17,.88);color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);font-size:10px;font-weight:720;line-height:1.15;white-space:nowrap;cursor:pointer}
  .family-map-name-pill.selected{background:#111;color:#fff;border-color:#fff}
  .family-map-name-pill .live-dot{width:5px;height:5px;flex:0 0 5px;border-radius:50%;background:#89d8a2}
  .family-map-marker.historical{opacity:.65}.family-map-marker{transition:none!important;position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 5px 10px rgba(0,0,0,.28));cursor:pointer;border:0;background:transparent;padding:0}.family-map-marker-dot{position:relative;width:48px;height:48px;border:3px solid #fff;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#4c367f;color:#fff;font-weight:800;font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,.22)}.family-map-marker.fresh .family-map-marker-dot::before{content:"";position:absolute;inset:-9px;border:2px solid rgba(73,157,105,.4);border-radius:50%;animation:familyLocationPulse 2s ease-out infinite;pointer-events:none}@keyframes familyLocationPulse{0%{transform:scale(.72);opacity:.85}100%{transform:scale(1.35);opacity:0}}.family-map-marker-dot img{width:100%;height:100%;object-fit:cover;display:block}.family-map-marker.mine .family-map-marker-dot{background:#171716}.family-map-marker::after{content:"";width:3px;height:12px;border-radius:3px;background:#fff;margin-top:-1px}.family-map-marker-label{margin-top:3px;padding:4px 7px;border-radius:9px;background:rgba(23,23,22,.86);color:#fff;font-size:9px;font-weight:700;white-space:nowrap}
  .family-map-loading{position:absolute;top:47%;left:50%;transform:translate(-50%,-50%);width:max-content;max-width:80%;z-index:3;padding:12px 17px;text-align:center;border:1px solid #ffffffa9;border-radius:18px;background:rgba(250,248,242,.94);color:#5f5a52;font-size:12px;pointer-events:none;box-shadow:0 8px 22px #0001}.family-map-error{position:absolute;inset:0;z-index:6;display:grid;place-items:center;padding:30px;text-align:center;background:linear-gradient(145deg,#d9d3c7,#f2eee6);color:#5f5a52;font-size:13px}.family-map-error b{display:block;color:#171716;font:500 22px var(--display-font,Georgia,serif);margin-bottom:7px}.family-map-loading[hidden],.family-map-error[hidden],[data-map-loading][hidden]{display:none!important}.family-map-popup .maplibregl-popup-content{border-radius:16px;padding:12px 14px;box-shadow:0 12px 34px #0003;font-family:system-ui,sans-serif}.family-map-popup b{display:block;font-size:13px}.family-map-popup small{display:block;margin-top:3px;color:#77736b}.family-map-popup .maplibregl-popup-close-button{font-size:18px;padding:2px 7px}.family-map-shell .maplibregl-ctrl-attrib{font-size:9px;background:rgba(255,255,255,.75)}.family-map-shell .maplibregl-ctrl-group{border-radius:14px;overflow:hidden;box-shadow:0 5px 18px #0002}
  @media(max-width:480px){.family-map-shell{height:var(--family-map-dynamic-height,min(52dvh,560px));min-height:310px;margin:10px 12px 16px;border-radius:28px}.family-map-head{left:10px;right:10px;top:10px}.family-map-people{top:78px;left:10px;right:10px}.family-map-head>div{padding:9px 11px}.family-map-head b{font-size:17px}.family-map-all,.family-map-mine{height:39px;padding:0 12px}.family-map-marker-label{display:none}}
  `
  document.head.appendChild(style)
}

function loadMapLibre(){
  ensureAssets()
  if(!maplibrePromise)maplibrePromise=import(/* @vite-ignore */ MAPLIBRE_JS).catch(error=>{maplibrePromise=null;throw error})
  return maplibrePromise
}

function clearMarkers(){
  markers.forEach(marker=>{try{marker.remove()}catch{}})
  markers.clear()
}

function destroyMap(){
  generation++
  mapLoaded=false
  focusGeneration++
  pendingFocusMemberId=''
  resizeObserver?.disconnect()
  resizeObserver=null
  clearMarkers()
  selectedLiveMemberId=''
  currentLocations=[]
  lastLocationSignature=''
  if(activePopup){try{activePopup.remove()}catch{}}
  activePopup=null
  activePopupMemberId=''
  if(map){try{map.remove()}catch{}}
  map=null
}

function ensurePanel(page:HTMLElement){
  let shell=page.querySelector<HTMLElement>('[data-family-map]')
  if(shell)return shell
  const locationBox=page.querySelector<HTMLElement>('.locationbox')
  if(!locationBox)return null
  shell=document.createElement('section')
  shell.className='family-map-shell'
  shell.dataset.familyMap='true'
  shell.innerHTML=`<div class="family-map-canvas" data-family-map-canvas></div><div class="family-map-head"><div><small>FAMILY MAP · 3D</small><b data-map-title>Familia cerca</b></div><div class="family-map-actions"><button type="button" class="family-map-mine" data-map-mine>Yo</button><button type="button" class="family-map-all" data-map-all>Todos</button></div></div><div class="family-map-people" data-map-people aria-label="Familia compartiendo ubicación" hidden></div><div class="family-map-loading" data-map-loading>Preparando mapa 3D…</div>`
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  if(gated)locationBox.insertAdjacentElement('afterend',shell)
  else locationBox.insertAdjacentElement('beforebegin',shell)
  shell.querySelector('[data-map-all]')?.addEventListener('click',()=>{
    selectedLiveMemberId=''
    updateLiveSelection()
    focusGeneration++
      pendingFocusMemberId=''
    void applyState(getLocationState()).then(fitAll)
    void refreshLocationState({force:true})
  })
  shell.querySelector('[data-map-mine]')?.addEventListener('click',()=>{
    const mine=currentLocations.find(item=>item.mine)
    if(mine){focus(mine,true);void refreshMemberLocation(mine.member_id);return}
    const memberId=getMemberId()
    if(memberId)requestMemberFocus(memberId)
  })
  return shell
}

async function locationsFromState(state:LocationState):Promise<MapLocation[]>{
  const me=getMemberId()
  const names=new Map(state.members.map(member=>[member.id,member.name]))
  const profileMap=new Map(state.profiles.map(profile=>[profile.member_id,profile.avatar_path]))
  // Avatar authorization is optional: it must never hold family markers hostage.
  const ownGpsOff=hasNativeLocationCapability()&&!isDeviceLocationEnabled()
  const now=Date.now()
  const visible=state.locations.filter(row=>
    isCurrentFamilyLocation(row,now)&&!(row.member_id===me&&ownGpsOff)
  )
  const paths=visible.map(row=>profileMap.get(row.member_id)||null)
  void primeMedia(paths).then(()=>{
    if(!map||!mapLoaded)return
    let changed=false
    currentLocations=currentLocations.map(item=>{
      const next=mediaUrl(item.avatarPath)
      if(!next||next===item.avatarUrl)return item
      changed=true
      return {...item,avatarUrl:next}
    })
    if(changed){
      const MapLibre=(window as any).__familiaMapLibre
      if(MapLibre)renderMarkers(MapLibre)
      syncActivePopup()
    }
  }).catch(error=>console.warn('Family avatar loading unavailable',error))
  return visible.map(row=>{
    const avatarPath=profileMap.get(row.member_id)||null
    return {
      ...row,
      name:names.get(row.member_id)||'Familia',
      mine:row.member_id===me,
      avatarPath,
      avatarUrl:mediaUrl(avatarPath),
    }
  })
}

function add3dBuildings(instance:any){
  try{
    if(!instance.getSource('familia-openfreemap'))instance.addSource('familia-openfreemap',{type:'vector',url:VECTOR_SOURCE})
    if(instance.getLayer('familia-buildings-3d'))return
    const layers=instance.getStyle()?.layers||[]
    const firstLabel=layers.find((layer:any)=>layer.type==='symbol'&&layer.layout?.['text-field'])?.id
    instance.addLayer({
      id:'familia-buildings-3d',
      source:'familia-openfreemap',
      'source-layer':'building',
      type:'fill-extrusion',
      minzoom:12.5,
      filter:['!=',['get','hide_3d'],true],
      paint:{
        'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],0],0,'#d8d2c7',80,'#bdb5a8',220,'#968d80'],
        'fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],7],
        'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
        'fill-extrusion-opacity':0.82,
      },
    },firstLabel)
  }catch(error){
    console.warn('3D buildings unavailable',error)
  }
}

function syncMarkerViewport(){
  if(!map||!mapLoaded)return
  const canvas=map.getCanvas()
  const width=canvas?.clientWidth||0
  const height=canvas?.clientHeight||0
  if(!width||!height)return
  for(const [memberId,marker] of markers){
    const item=currentLocations.find(row=>row.member_id===memberId)
    const element=marker.getElement() as HTMLElement
    if(!item){element.style.visibility='hidden';continue}
    const pixel=map.project([item.longitude,item.latitude])
    // DOM markers outside the current rendered viewport must never flash near
    // the selected family member during camera jumps.
    const visible=Number.isFinite(pixel.x)&&Number.isFinite(pixel.y)&&
      pixel.x>=-40&&pixel.x<=width+40&&pixel.y>=-72&&pixel.y<=height+40
    element.style.visibility=visible?'visible':'hidden'
  }
}

function fitAll(){
  if(!map||!currentLocations.length)return
  if(currentLocations.length===1){
    const item=currentLocations[0]
    map.flyTo({center:[item.longitude,item.latitude],zoom:16.4,pitch:52,bearing:-24,duration:750,curve:1.28,essential:true,padding:{top:50,right:25,bottom:42,left:25}})
    return
  }
  const MapLibre=(window as any).__familiaMapLibre
  if(!MapLibre)return
  const bounds=new MapLibre.LngLatBounds()
  currentLocations.forEach(item=>bounds.extend([item.longitude,item.latitude]))
  map.fitBounds(bounds,{padding:{top:95,right:55,bottom:50,left:55},maxZoom:13.4,pitch:0,bearing:0,duration:900})
}

function popupHtml(item:MapLocation){
  return `<b>${esc(item.name)}${item.mine?' · tú':''}</b><small>Posición actual · ${esc(age(item.updated_at))}${Number.isFinite(item.accuracy)?` · ±${Math.round(item.accuracy as number)} m`:''}</small>`
}

function syncActivePopup(){
  if(!map||!activePopup||!activePopupMemberId)return
  const item=currentLocations.find(location=>location.member_id===activePopupMemberId)
  if(!item)return
  activePopup
    .setLngLat([item.longitude,item.latitude])
    .setHTML(popupHtml(item))
}

function updateLiveSelection(){
  document.querySelectorAll<HTMLButtonElement>('[data-map-live-member]').forEach(button=>{
    const selected=button.dataset.mapLiveMember===selectedLiveMemberId
    button.classList.toggle('selected',selected)
    button.setAttribute('aria-pressed',String(selected))
  })
}

function renderLivePeople(shell:HTMLElement){
  const root=shell.querySelector<HTMLElement>('[data-map-people]')
  if(!root)return
  const live=currentLocations
    .filter(item=>isCurrentFamilyLocation(item)&&!(item.mine&&hasNativeLocationCapability()&&!isDeviceLocationEnabled()))
    .sort((a,b)=>Number(b.mine)-Number(a.mine)||a.name.localeCompare(b.name,'es'))
  const signature=live.map(item=>[item.member_id,item.name,item.mine].join(':')).join('|')
  root.hidden=live.length===0
  if(root.dataset.signature===signature){updateLiveSelection();return}
  root.dataset.signature=signature
  root.innerHTML=live.map(item=>`<button class="family-map-name-pill" type="button" data-map-live-member="${esc(item.member_id)}" aria-pressed="false" aria-label="Mostrar a ${esc(item.name)} en el mapa"><span class="live-dot" aria-hidden="true"></span>${esc(item.name)}${item.mine?' · tú':''}</button>`).join('')
  root.querySelectorAll<HTMLButtonElement>('[data-map-live-member]').forEach(button=>{
    button.addEventListener('click',event=>{
      event.stopPropagation()
      const item=currentLocations.find(row=>row.member_id===button.dataset.mapLiveMember)
      if(!item)return
      focus(item,true)
      void refreshMemberLocation(item.member_id)
    })
  })
  updateLiveSelection()
}

function focus(item:MapLocation,showPopup=false){
  if(!map)return
  selectedLiveMemberId=isCurrentFamilyLocation(item)?item.member_id:''
  updateLiveSelection()
  // Hide stale DOM projections until MapLibre has rendered the new camera.
  // Otherwise markers outside the view can flash beside the selected person.
  const token=++focusGeneration
  markers.forEach(marker=>{(marker.getElement() as HTMLElement).style.visibility='hidden'})
  map.stop()
  map.jumpTo({
    center:[item.longitude,item.latitude],
    zoom:16.9,
    pitch:52,
    bearing:-24,
    padding:{top:60,right:25,bottom:50,left:25},
  })
  const reveal=()=>{
    if(token!==focusGeneration||!map)return
    syncMarkerViewport()
  }
  map.once('render',reveal)
  // The render event can be absent when the map was already fully painted.
  window.setTimeout(reveal,120)
  const title=document.querySelector<HTMLElement>('[data-map-title]')
  if(title)title.textContent=item.mine?'Tu ubicación':item.name
  if(showPopup){
    const MapLibre=(window as any).__familiaMapLibre
    if(MapLibre){
      activePopupMemberId=item.member_id
      if(!activePopup){
        activePopup=new MapLibre.Popup({offset:36,className:'family-map-popup',closeButton:true})
        activePopup.on('close',()=>{activePopupMemberId=''})
      }
      activePopup
        .setLngLat([item.longitude,item.latitude])
        .setHTML(popupHtml(item))
        .addTo(map)
    }
  }
}

function renderMarkers(MapLibre:any){
  // Single marker per member; updates move it without flicker or camera changes.
  const ids=new Set(currentLocations.map(item=>item.member_id))
  for(const [id,marker] of markers){
    if(ids.has(id))continue
    try{marker.remove()}catch{}
    markers.delete(id)
  }
  for(const item of currentLocations){
    const fresh=isCurrentFamilyLocation(item)&&!(item.mine&&hasNativeLocationCapability()&&!isDeviceLocationEnabled())
    let marker=markers.get(item.member_id)
    let element:HTMLButtonElement
    if(marker){
      element=marker.getElement() as HTMLButtonElement
      // Do not reproject unchanged GPS points during camera changes.
      const point=marker.getLngLat()
      if(Math.abs(point.lng-item.longitude)>0.0000001||
         Math.abs(point.lat-item.latitude)>0.0000001){
        marker.setLngLat([item.longitude,item.latitude])
      }
    }else{
      element=document.createElement('button')
      element.type='button'
      marker=new MapLibre.Marker({element,anchor:'bottom'})
        .setLngLat([item.longitude,item.latitude])
        .addTo(map)
      markers.set(item.member_id,marker)
      element.addEventListener('click',event=>{
        event.stopPropagation()
        const latest=currentLocations.find(row=>row.member_id===item.member_id)
        if(latest){
          focus(latest,true)
          void refreshMemberLocation(latest.member_id)
        }
      })
    }
    element.className=`family-map-marker${item.mine?' mine':''}${fresh?' fresh':' historical'}`
    element.setAttribute('aria-label',`Ver ubicación de ${item.name}`)
    const signature=[item.name,item.avatarUrl,item.mine].join('|')
    if(element.dataset.mapAvatar!==signature){
      element.dataset.mapAvatar=signature
      element.innerHTML=`<span class="family-map-marker-dot">${avatarMarkup(item)}</span><span class="family-map-marker-label">${esc(item.name)}</span>`
      bindAvatarFallback(element)
    }
  }
  syncMarkerViewport()
}

function showOverlay(shell:HTMLElement,kind:'loading'|'empty'|'error'){
  const overlay=shell.querySelector<HTMLElement>('[data-map-loading]')
  if(!overlay)return
  overlay.hidden=false
  if(kind==='loading'){
    overlay.className='family-map-loading'
    overlay.textContent='Preparando mapa 3D…'
    return
  }
  overlay.className='family-map-error'
  overlay.innerHTML=kind==='empty'
    ?'<div><b>Sin ubicaciones activas</b><span>Los familiares aparecerán aquí cuando compartan una posición reciente.</span></div>'
    :'<div><b>Mapa no disponible</b><span>La lista de ubicaciones sigue funcionando normalmente.</span></div>'
}

function hideOverlay(shell:HTMLElement){
  const overlay=shell.querySelector<HTMLElement>('[data-map-loading]')
  if(!overlay)return
  overlay.hidden=true
}

async function applyState(state:LocationState){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(!page)return
  const shell=ensurePanel(page)
  if(!shell)return
  // Generation tracks page lifetime only: GPS/Realtime events MUST NOT cancel map initialization.
  const run=generation

  if(!state.updatedAt&&!state.error){
    showOverlay(shell,'loading')
    return
  }
  if(state.error&&!state.updatedAt){
    showOverlay(shell,'error')
    return
  }

  const locations=await locationsFromState(state)
  if(run!==generation||!document.contains(shell))return
  const previouslyEmpty=currentLocations.length===0
  const signature=locations
    .map(item=>[item.member_id,item.latitude.toFixed(6),item.longitude.toFixed(6),item.updated_at,item.avatarPath||''].join(':'))
    .sort()
    .join('|')
  const changed=signature!==lastLocationSignature
  currentLocations=locations
  // Each new active relative replaces one full-size list row with a tiny
  // name pill on the map. Reclaim part of that room for map height.
  const liveCount=locations.filter(item=>
    isCurrentFamilyLocation(item)&&!(item.mine&&hasNativeLocationCapability()&&!isDeviceLocationEnabled())
  ).length
  const heightDvh=Math.min(46+liveCount*7,77)
  const heightPx=Math.min(470+liveCount*60,790)
  shell.style.setProperty('--family-map-dynamic-height',`min(${heightDvh}dvh,${heightPx}px)`)
  renderLivePeople(shell)

  if(!locations.length){
    lastLocationSignature=''
    selectedLiveMemberId=''
    clearMarkers()
    if(activePopup){try{activePopup.remove()}catch{}}
    activePopup=null
    activePopupMemberId=''
    showOverlay(shell,'empty')
    return
  }

  if(map&&!mapLoaded)return

  if(map&&!changed){
    hideOverlay(shell)
    revealPendingFocus()
    setTimeout(()=>{try{map.resize()}catch{}},20)
    return
  }

  if(!map)showOverlay(shell,'loading')
  try{
    const MapLibre=await loadMapLibre()
    if(run!==generation||!document.contains(shell))return
    ;(window as any).__familiaMapLibre=MapLibre

    if(!map){
      const mine=locations.find(item=>item.mine)||locations[0]
      map=new MapLibre.Map({
        container:shell.querySelector<HTMLElement>('[data-family-map-canvas]')!,
        style:MAP_STYLE,
        center:[mine.longitude,mine.latitude],
        zoom:16,
        pitch:52,
        bearing:-24,
        maxPitch:70,
        attributionControl:false,
        // Restore original gestures: one finger pans; two fingers tilt/pinch.
        cooperativeGestures:false,
        dragPan:true,
        touchZoomRotate:true,
        touchPitch:true,
        canvasContextAttributes:{antialias:true},
      })
      map.addControl(new MapLibre.NavigationControl({showZoom:false,showCompass:true,visualizePitch:true}),'top-right')
      map.addControl(new MapLibre.AttributionControl({compact:true}),'bottom-right')
      if('ResizeObserver' in window){
        resizeObserver?.disconnect()
        resizeObserver=new ResizeObserver(()=>{try{map?.resize()}catch{}})
        resizeObserver.observe(shell)
      }
      const instance=map
      instance.on('load',()=>{
        if(map!==instance||run!==generation||!document.contains(shell))return
        mapLoaded=true
        add3dBuildings(instance)
        renderMarkers(MapLibre)
        // Update visibility only once the new MapLibre camera has rendered.
        instance.on('moveend',syncMarkerViewport)
        instance.on('resize',syncMarkerViewport)
        syncActivePopup()
        lastLocationSignature=currentLocations
          .map(item=>[item.member_id,item.latitude.toFixed(6),item.longitude.toFixed(6),item.updated_at,item.avatarPath||''].join(':'))
          .sort().join('|')
        // Do not fly to an overview on entry: start at the current member.
        hideOverlay(shell)
        revealPendingFocus()
      })
      map.on('error',(event:any)=>console.warn('Family map resource error',event?.error||event))
      return
    }

    renderMarkers(MapLibre)
    syncActivePopup()
    lastLocationSignature=signature
    hideOverlay(shell)
    if(pendingFocusMemberId)revealPendingFocus()
    else if(previouslyEmpty){
      const mine=locations.find(item=>item.mine)||locations[0]
      if(mine)focus(mine)
    }
    setTimeout(()=>{try{map.resize()}catch{}},40)
  }catch(error){
    console.error('Family 3D map failed to load',error)
    showOverlay(shell,'error')
  }
}

// A saved location is not eligible for map focus unless it is CURRENT and accurate.
function revealPendingFocus(){
  if(!pendingFocusMemberId||!map||!mapLoaded)return
  const item=currentLocations.find(row=>row.member_id===pendingFocusMemberId)
  if(!item)return
  pendingFocusMemberId=''
  focus(item,true)
}

function requestMemberFocus(memberId:string){
  if(!memberId)return
  const current=currentLocations.find(row=>row.member_id===memberId)
  if(current){focus(current,true);return}
  if(!getLocationState().locations.some(row=>row.member_id===memberId&&isCurrentFamilyLocation(row)))return
  pendingFocusMemberId=memberId
  void applyState(getLocationState())
}

function handleFocusEvent(event:Event){
  const custom=event as CustomEvent<{memberId?:string}>
  const memberId=String(custom.detail?.memberId||'')
  if(!memberId)return
  requestMemberFocus(memberId)
}

window.addEventListener('familia-noa:focus-location',handleFocusEvent as EventListener)
window.addEventListener('familia-noa:android-resumed',()=>{
  if(activePage)void applyState(getLocationState())
})

function attachPage(page:HTMLElement){
  ensurePanel(page)
  if(liveRefreshTimer!==null)window.clearInterval(liveRefreshTimer)
  // Positions expire from the live map automatically, even without a new
  // database event. A fresh update brings the marker back on Realtime.
  liveRefreshTimer=window.setInterval(()=>{
    if(!document.hidden)void applyState(getLocationState())
  },30_000)
  // Start engine and location data fetching concurrently.
  void loadMapLibre().catch(error=>console.warn('Family map engine unavailable',error))
  stateUnsubscribe?.()
  stateUnsubscribe=subscribeLocationState(state=>{void applyState(state)})
  const state=getLocationState()
  void applyState(state)
  void refreshLocationState({force:true})
}

function scan(){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(page===activePage)return
  if(liveRefreshTimer!==null){window.clearInterval(liveRefreshTimer);liveRefreshTimer=null}
  stateUnsubscribe?.()
  stateUnsubscribe=null
  destroyMap()
  activePage=page
  if(page)attachPage(page)
}

ensureAssets()
pageObserver=new MutationObserver(scan)
pageObserver.observe(document.body,{childList:true,subtree:true})
window.addEventListener('beforeunload',()=>{
  if(liveRefreshTimer!==null)window.clearInterval(liveRefreshTimer)
  stateUnsubscribe?.()
  stateUnsubscribe=null
  pageObserver?.disconnect()
  pageObserver=null
  destroyMap()
  window.removeEventListener('familia-noa:focus-location',handleFocusEvent as EventListener)
},{once:true})
scan()

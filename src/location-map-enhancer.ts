import { getMemberId } from './core/identity'
import { mediaUrl, primeMedia } from './core/private-media'
import { getLocationState, refreshLocationState, subscribeLocationState, type LocationState } from './core/location-store'
import { refreshMemberLocation } from './core/location-device-sync'

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
let markers:any[]=[]
let currentLocations:MapLocation[]=[]
let lastLocationSignature=''
let lastMemberSignature=''
let activePage:Element|null=null
let pageObserver:MutationObserver|null=null
let stateUnsubscribe:(()=>void)|null=null
let generation=0

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
  .family-map-shell{position:relative;height:min(62dvh,560px);min-height:420px;margin:14px 16px 18px;border-radius:32px;overflow:hidden;background:#ddd8ce;border:1px solid rgba(218,211,198,.9);box-shadow:0 22px 56px rgba(35,31,25,.14);isolation:isolate}.family-map-canvas{position:absolute;inset:0}.family-map-canvas .maplibregl-canvas{outline:none}.family-map-shell::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(12,12,12,.16),transparent 28%,transparent 62%,rgba(12,12,12,.42));z-index:2}
  .family-map-head{position:absolute;left:14px;right:14px;top:14px;z-index:4;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;pointer-events:none}.family-map-head>div{padding:10px 13px;border-radius:18px;background:rgba(250,248,242,.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 6px 22px #0001}.family-map-head small{display:block;font-size:8.5px;letter-spacing:.16em;font-weight:800;color:#77736b}.family-map-head b{display:block;margin-top:2px;font:500 19px var(--display-font,Georgia,serif);color:#171716}.family-map-actions{display:flex;gap:7px;pointer-events:auto}.family-map-all,.family-map-mine{height:42px;padding:0 14px;border:0;border-radius:21px;font-weight:750;font-size:11px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 6px 18px #0002}.family-map-all{background:rgba(23,23,22,.92);color:#fff}.family-map-mine{background:rgba(250,248,242,.92);color:#171716}
  .family-map-people{position:absolute;z-index:4;left:10px;right:10px;bottom:10px;display:flex;gap:7px;overflow-x:auto;padding:2px 2px max(2px,env(safe-area-inset-bottom));scrollbar-width:none}.family-map-people::-webkit-scrollbar{display:none}.family-map-chip{flex:0 0 auto;display:grid;grid-template-columns:31px auto;grid-template-rows:auto auto;column-gap:8px;align-items:center;min-height:48px;padding:5px 12px 5px 6px;border:1px solid rgba(255,255,255,.45);border-radius:25px;background:rgba(250,248,242,.94);color:#171716;font-size:11.5px;font-weight:750;text-align:left;box-shadow:0 6px 20px #0002;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.family-map-chip small{grid-column:2;display:block;margin-top:-1px;color:#807b73;font-size:8.5px;font-weight:650}.family-map-chip-avatar{grid-row:1/3;width:31px;height:31px;flex:0 0 31px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#e8e1d4;font-size:11px}.family-map-chip-avatar img{width:100%;height:100%;object-fit:cover;display:block}.family-map-chip.mine{background:rgba(23,23,22,.94);color:#fff;border-color:rgba(23,23,22,.92)}.family-map-chip.mine small{color:#bdb8af}.family-map-chip.mine .family-map-chip-avatar{background:#fff;color:#171716}
  .family-map-marker{position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 5px 10px rgba(0,0,0,.28));cursor:pointer;border:0;background:transparent;padding:0}.family-map-marker-dot{position:relative;width:48px;height:48px;border:3px solid #fff;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#4c367f;color:#fff;font-weight:800;font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,.22)}.family-map-marker.fresh .family-map-marker-dot::before{content:"";position:absolute;inset:-9px;border:2px solid rgba(73,157,105,.4);border-radius:50%;animation:familyLocationPulse 2s ease-out infinite;pointer-events:none}@keyframes familyLocationPulse{0%{transform:scale(.72);opacity:.85}100%{transform:scale(1.35);opacity:0}}.family-map-marker-dot img{width:100%;height:100%;object-fit:cover;display:block}.family-map-marker.mine .family-map-marker-dot{background:#171716}.family-map-marker::after{content:"";width:3px;height:12px;border-radius:3px;background:#fff;margin-top:-1px}.family-map-marker-label{margin-top:3px;padding:4px 7px;border-radius:9px;background:rgba(23,23,22,.86);color:#fff;font-size:9px;font-weight:700;white-space:nowrap}
  .family-map-loading,.family-map-error{position:absolute;inset:0;z-index:6;display:grid;place-items:center;padding:30px;text-align:center;background:linear-gradient(145deg,#d9d3c7,#f2eee6);color:#5f5a52;font-size:13px}.family-map-error b{display:block;color:#171716;font:500 22px var(--display-font,Georgia,serif);margin-bottom:7px}.family-map-loading[hidden],.family-map-error[hidden],[data-map-loading][hidden]{display:none!important}.family-map-popup .maplibregl-popup-content{border-radius:16px;padding:12px 14px;box-shadow:0 12px 34px #0003;font-family:system-ui,sans-serif}.family-map-popup b{display:block;font-size:13px}.family-map-popup small{display:block;margin-top:3px;color:#77736b}.family-map-popup .maplibregl-popup-close-button{font-size:18px;padding:2px 7px}.family-map-shell .maplibregl-ctrl-attrib{font-size:9px;background:rgba(255,255,255,.75)}.family-map-shell .maplibregl-ctrl-group{border-radius:14px;overflow:hidden;box-shadow:0 5px 18px #0002}
  @media(max-width:480px){.family-map-shell{height:55dvh;min-height:410px;margin:10px 12px 16px;border-radius:28px}.family-map-head{left:10px;right:10px;top:10px}.family-map-head>div{padding:9px 11px}.family-map-head b{font-size:17px}.family-map-all,.family-map-mine{height:39px;padding:0 12px}.family-map-people{bottom:9px;left:7px;right:7px}.family-map-marker-label{display:none}}
  `
  document.head.appendChild(style)
}

function loadMapLibre(){
  ensureAssets()
  if(!maplibrePromise)maplibrePromise=import(/* @vite-ignore */ MAPLIBRE_JS)
  return maplibrePromise
}

function clearMarkers(){
  markers.forEach(marker=>{try{marker.remove()}catch{}})
  markers=[]
  const people=document.querySelector<HTMLElement>('[data-map-people]')
  if(people)people.innerHTML=''
}

function destroyMap(){
  generation++
  clearMarkers()
  currentLocations=[]
  lastLocationSignature=''
  lastMemberSignature=''
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
  shell.innerHTML=`<div class="family-map-canvas" data-family-map-canvas></div><div class="family-map-head"><div><small>FAMILY MAP · 3D</small><b data-map-title>Familia cerca</b></div><div class="family-map-actions"><button type="button" class="family-map-mine" data-map-mine>Yo</button><button type="button" class="family-map-all" data-map-all>Todos</button></div></div><div class="family-map-people" data-map-people></div><div class="family-map-loading" data-map-loading>Preparando mapa 3D…</div>`
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  if(gated)locationBox.insertAdjacentElement('afterend',shell)
  else locationBox.insertAdjacentElement('beforebegin',shell)
  shell.querySelector('[data-map-all]')?.addEventListener('click',()=>{
    fitAll()
    void refreshLocationState({force:true})
  })
  shell.querySelector('[data-map-mine]')?.addEventListener('click',()=>{
    const mine=currentLocations.find(item=>item.mine)
    if(!mine)return
    focus(mine,true)
    void refreshMemberLocation(mine.member_id)
  })
  return shell
}

async function locationsFromState(state:LocationState):Promise<MapLocation[]>{
  const me=getMemberId()
  const names=new Map(state.members.map(member=>[member.id,member.name]))
  const profileMap=new Map(state.profiles.map(profile=>[profile.member_id,profile.avatar_path]))
  const paths=state.locations.map(row=>profileMap.get(row.member_id)||null)
  await primeMedia(paths)
  return state.locations.map(row=>{
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

function fitAll(){
  if(!map||!currentLocations.length)return
  if(currentLocations.length===1){
    const item=currentLocations[0]
    map.flyTo({center:[item.longitude,item.latitude],zoom:16.4,pitch:66,bearing:-28,duration:900,curve:1.28,essential:true,padding:{top:50,right:25,bottom:105,left:25}})
    return
  }
  const MapLibre=(window as any).__familiaMapLibre
  if(!MapLibre)return
  const bounds=new MapLibre.LngLatBounds()
  currentLocations.forEach(item=>bounds.extend([item.longitude,item.latitude]))
  map.fitBounds(bounds,{padding:{top:95,right:55,bottom:120,left:55},maxZoom:13.4,duration:900})
}

function focus(item:MapLocation,showPopup=false){
  if(!map)return
  map.flyTo({center:[item.longitude,item.latitude],zoom:17.4,pitch:70,bearing:-32,duration:1050,curve:1.38,essential:true,padding:{top:60,right:25,bottom:120,left:25}})
  const title=document.querySelector<HTMLElement>('[data-map-title]')
  if(title)title.textContent=item.mine?'Tu ubicación':item.name
  document.querySelectorAll<HTMLElement>('.family-map-chip').forEach(chip=>chip.classList.toggle('selected',chip.dataset.mapMember===item.member_id))
  if(showPopup){
    const MapLibre=(window as any).__familiaMapLibre
    if(MapLibre){
      new MapLibre.Popup({offset:36,className:'family-map-popup',closeButton:true})
        .setLngLat([item.longitude,item.latitude])
        .setHTML(`<b>${esc(item.name)}${item.mine?' · tú':''}</b><small>${esc(age(item.updated_at))}${Number.isFinite(item.accuracy)?` · ±${Math.round(item.accuracy as number)} m`:''}</small>`)
        .addTo(map)
    }
  }
}

function renderPeople(){
  const root=document.querySelector<HTMLElement>('[data-map-people]')
  if(!root)return
  root.innerHTML=currentLocations.map(item=>`<button type="button" class="family-map-chip${item.mine?' mine':''}" data-map-member="${esc(item.member_id)}"><span class="family-map-chip-avatar">${avatarMarkup(item)}</span><span>${esc(item.name)}${item.mine?' · tú':''}</span><small>${esc(age(item.updated_at))}</small></button>`).join('')
  bindAvatarFallback(root)
  root.querySelectorAll<HTMLButtonElement>('[data-map-member]').forEach(button=>button.addEventListener('click',()=>{
    const memberId=button.dataset.mapMember||''
    const item=currentLocations.find(location=>location.member_id===memberId)
    if(item)focus(item,true)
    void refreshMemberLocation(memberId)
  }))
}

function renderMarkers(MapLibre:any){
  clearMarkers()
  currentLocations.forEach(item=>{
    const element=document.createElement('button')
    element.type='button'
    const fresh=Date.now()-new Date(item.updated_at).getTime()<5*60*1000
    element.className=`family-map-marker${item.mine?' mine':''}${fresh?' fresh':''}`
    element.setAttribute('aria-label',`Ver ubicación de ${item.name}`)
    element.innerHTML=`<span class="family-map-marker-dot">${avatarMarkup(item)}</span><span class="family-map-marker-label">${esc(item.name)}</span>`
    bindAvatarFallback(element)
    element.addEventListener('click',event=>{
      event.stopPropagation()
      focus(item,true)
      void refreshMemberLocation(item.member_id)
    })
    markers.push(new MapLibre.Marker({element,anchor:'bottom'}).setLngLat([item.longitude,item.latitude]).addTo(map))
  })
  renderPeople()
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
    ?'<div><b>Aún no hay ubicaciones</b><span>Cuando alguien comparta su ubicación, aparecerá aquí.</span></div>'
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
  const run=++generation

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
  const signature=locations
    .map(item=>[item.member_id,item.latitude.toFixed(6),item.longitude.toFixed(6),item.updated_at,item.avatarPath||''].join(':'))
    .sort()
    .join('|')
  const memberSignature=locations.map(item=>item.member_id).sort().join('|')
  const changed=signature!==lastLocationSignature
  const membersChanged=memberSignature!==lastMemberSignature
  currentLocations=locations

  if(!locations.length){
    lastLocationSignature=''
    lastMemberSignature=''
    clearMarkers()
    showOverlay(shell,'empty')
    return
  }

  if(map&&!changed){
    hideOverlay(shell)
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
        zoom:locations.length===1?16:10.5,
        pitch:60,
        bearing:-24,
        maxPitch:80,
        attributionControl:false,
        canvasContextAttributes:{antialias:true},
      })
      map.addControl(new MapLibre.NavigationControl({showZoom:false,showCompass:true,visualizePitch:true}),'top-right')
      map.addControl(new MapLibre.AttributionControl({compact:true}),'bottom-right')
      map.on('load',()=>{
        add3dBuildings(map)
        renderMarkers(MapLibre)
        lastLocationSignature=signature
        lastMemberSignature=memberSignature
        fitAll()
        hideOverlay(shell)
      })
      map.on('error',(event:any)=>console.warn('Family map resource error',event?.error||event))
      return
    }

    renderMarkers(MapLibre)
    lastLocationSignature=signature
    lastMemberSignature=memberSignature
    if(membersChanged)fitAll()
    hideOverlay(shell)
    setTimeout(()=>{try{map.resize()}catch{}},40)
  }catch(error){
    console.error('Family 3D map failed to load',error)
    showOverlay(shell,'error')
  }
}

function handleFocusEvent(event:Event){
  const custom=event as CustomEvent<{memberId?:string}>
  const memberId=String(custom.detail?.memberId||'')
  if(!memberId)return
  const item=currentLocations.find(location=>location.member_id===memberId)
  if(item)focus(item,true)
}

window.addEventListener('familia-noa:focus-location',handleFocusEvent as EventListener)

function attachPage(page:HTMLElement){
  ensurePanel(page)
  stateUnsubscribe?.()
  stateUnsubscribe=subscribeLocationState(state=>{void applyState(state)})
  const state=getLocationState()
  void applyState(state)
  void refreshLocationState({force:true})
}

function scan(){
  const page=document.querySelector<HTMLElement>('.location-page')
  if(page===activePage)return
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
  stateUnsubscribe?.()
  stateUnsubscribe=null
  pageObserver?.disconnect()
  pageObserver=null
  destroyMap()
  window.removeEventListener('familia-noa:focus-location',handleFocusEvent as EventListener)
},{once:true})
scan()

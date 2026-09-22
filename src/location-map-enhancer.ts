import { supabase } from './supabase'
import { getMemberId } from './core/identity'

const MAPLIBRE_JS='https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs'
const MAPLIBRE_CSS='https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.css'
const MAP_STYLE='https://tiles.openfreemap.org/styles/liberty'
const VECTOR_SOURCE='https://tiles.openfreemap.org/planet'

type Member={id:string;name:string;active:boolean}
type LocationRow={member_id:string;latitude:number;longitude:number;accuracy:number|null;updated_at:string}
type MapLocation=LocationRow&{name:string;mine:boolean}

let maplibrePromise:Promise<any>|null=null
let map:any=null
let markers:any[]=[]
let currentLocations:MapLocation[]=[]
let activePage:Element|null=null
let pageObserver:MutationObserver|null=null
let listObserver:MutationObserver|null=null
let refreshTimer:number|null=null
let generation=0

function esc(value:string){return value.replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[char]||char))}
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
    link.rel='stylesheet';link.href=MAPLIBRE_CSS;link.dataset.familyMaplibre='true'
    document.head.appendChild(link)
  }
  if(document.getElementById('family-map-styles'))return
  const style=document.createElement('style')
  style.id='family-map-styles'
  style.textContent=`
  .family-map-shell{position:relative;height:min(58dvh,510px);min-height:390px;margin:16px;border-radius:30px;overflow:hidden;background:#ddd8ce;border:1px solid rgba(218,211,198,.9);box-shadow:0 18px 45px rgba(35,31,25,.12);isolation:isolate}.family-map-canvas{position:absolute;inset:0}.family-map-canvas .maplibregl-canvas{outline:none}.family-map-shell::after{content:\"\";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(12,12,12,.18),transparent 30%,transparent 68%,rgba(12,12,12,.34));z-index:2}
  .family-map-head{position:absolute;left:16px;right:16px;top:16px;z-index:4;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;pointer-events:none}.family-map-head>div{padding:10px 13px;border-radius:17px;background:rgba(250,248,242,.91);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 5px 20px #0001}.family-map-head small{display:block;font-size:9px;letter-spacing:.16em;font-weight:800;color:#77736b}.family-map-head b{display:block;margin-top:2px;font:500 18px var(--display-font,Georgia,serif);color:#171716}.family-map-all{pointer-events:auto;height:42px;padding:0 15px;border:0;border-radius:21px;background:rgba(23,23,22,.9);color:#fff;font-weight:700;font-size:12px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
  .family-map-people{position:absolute;z-index:4;left:12px;right:12px;bottom:12px;display:flex;gap:7px;overflow-x:auto;padding:2px 2px max(2px,env(safe-area-inset-bottom));scrollbar-width:none}.family-map-people::-webkit-scrollbar{display:none}.family-map-chip{flex:0 0 auto;display:flex;align-items:center;gap:7px;height:43px;padding:0 12px 0 7px;border:1px solid rgba(255,255,255,.45);border-radius:22px;background:rgba(250,248,242,.92);color:#171716;font-size:12px;font-weight:700;box-shadow:0 5px 18px #0002;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.family-map-chip span{width:29px;height:29px;border-radius:50%;display:grid;place-items:center;background:#e8e1d4;font-size:11px}.family-map-chip.mine{background:rgba(23,23,22,.92);color:#fff;border-color:rgba(23,23,22,.92)}.family-map-chip.mine span{background:#fff;color:#171716}
  .family-map-marker{position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 5px 10px rgba(0,0,0,.28));cursor:pointer;border:0;background:transparent;padding:0}.family-map-marker-dot{width:42px;height:42px;border:3px solid #fff;border-radius:50%;display:grid;place-items:center;background:#4c367f;color:#fff;font-weight:800;font-size:13px}.family-map-marker.mine .family-map-marker-dot{background:#171716}.family-map-marker::after{content:\"\";width:3px;height:12px;border-radius:3px;background:#fff;margin-top:-1px}.family-map-marker-label{margin-top:3px;padding:4px 7px;border-radius:9px;background:rgba(23,23,22,.86);color:#fff;font-size:9px;font-weight:700;white-space:nowrap}
  .family-map-loading,.family-map-error{position:absolute;inset:0;z-index:6;display:grid;place-items:center;padding:30px;text-align:center;background:linear-gradient(145deg,#d9d3c7,#f2eee6);color:#5f5a52;font-size:13px}.family-map-error b{display:block;color:#171716;font:500 22px var(--display-font,Georgia,serif);margin-bottom:7px}.family-map-loading[hidden]{display:none}.family-map-popup .maplibregl-popup-content{border-radius:16px;padding:12px 14px;box-shadow:0 12px 34px #0003;font-family:system-ui,sans-serif}.family-map-popup b{display:block;font-size:13px}.family-map-popup small{display:block;margin-top:3px;color:#77736b}.family-map-popup .maplibregl-popup-close-button{font-size:18px;padding:2px 7px}.family-map-shell .maplibregl-ctrl-attrib{font-size:9px;background:rgba(255,255,255,.75)}.family-map-shell .maplibregl-ctrl-group{border-radius:14px;overflow:hidden;box-shadow:0 5px 18px #0002}
  @media(max-width:480px){.family-map-shell{height:48dvh;min-height:370px;margin:12px;border-radius:26px}.family-map-head{left:12px;right:12px;top:12px}.family-map-people{bottom:10px;left:9px;right:9px}.family-map-marker-label{display:none}}
  `
  document.head.appendChild(style)
}

function loadMapLibre(){ensureAssets();if(!maplibrePromise)maplibrePromise=import(/* @vite-ignore */ MAPLIBRE_JS);return maplibrePromise}
function destroyMap(){generation++;markers.forEach(marker=>{try{marker.remove()}catch{}});markers=[];currentLocations=[];if(map){try{map.remove()}catch{}};map=null;listObserver?.disconnect();listObserver=null;if(refreshTimer!==null){clearTimeout(refreshTimer);refreshTimer=null}}

function ensurePanel(page:HTMLElement){
  let shell=page.querySelector<HTMLElement>('[data-family-map]');if(shell)return shell
  const locationBox=page.querySelector<HTMLElement>('.locationbox');if(!locationBox)return null
  shell=document.createElement('section');shell.className='family-map-shell';shell.dataset.familyMap='true'
  shell.innerHTML=`<div class=\"family-map-canvas\" data-family-map-canvas></div><div class=\"family-map-head\"><div><small>FAMILY MAP · 3D</small><b>Familia cerca</b></div><button type=\"button\" class=\"family-map-all\" data-map-all>Todos</button></div><div class=\"family-map-people\" data-map-people></div><div class=\"family-map-loading\" data-map-loading>Preparando mapa 3D…</div>`
  const gated=!!page.querySelector('#sharelocation')?.textContent?.toLowerCase().includes('continuar')
  if(gated)locationBox.insertAdjacentElement('afterend',shell);else locationBox.insertAdjacentElement('beforebegin',shell)
  shell.querySelector('[data-map-all]')?.addEventListener('click',fitAll)
  return shell
}

async function fetchLocations():Promise<MapLocation[]>{
  const [membersResult,locationsResult]=await Promise.all([supabase.from('family_members').select('id,name,active').eq('active',true).order('created_at'),supabase.from('locations').select('member_id,latitude,longitude,accuracy,updated_at').order('updated_at',{ascending:false})])
  if(membersResult.error)throw membersResult.error;if(locationsResult.error)throw locationsResult.error
  const me=getMemberId();const names=new Map(((membersResult.data||[]) as Member[]).map(member=>[member.id,member.name]))
  return ((locationsResult.data||[]) as LocationRow[]).filter(row=>names.has(row.member_id)&&Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)).map(row=>({...row,name:names.get(row.member_id)||'Familia',mine:row.member_id===me}))
}

function add3dBuildings(instance:any){
  try{
    if(!instance.getSource('familia-openfreemap'))instance.addSource('familia-openfreemap',{type:'vector',url:VECTOR_SOURCE})
    if(instance.getLayer('familia-buildings-3d'))return
    const layers=instance.getStyle()?.layers||[];const firstLabel=layers.find((layer:any)=>layer.type==='symbol'&&layer.layout?.['text-field'])?.id
    instance.addLayer({id:'familia-buildings-3d',source:'familia-openfreemap','source-layer':'building',type:'fill-extrusion',minzoom:12.5,filter:['!=',['get','hide_3d'],true],paint:{'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],0],0,'#d8d2c7',80,'#bdb5a8',220,'#968d80'],'fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],7],'fill-extrusion-base':['coalesce',['get','render_min_height'],0],'fill-extrusion-opacity':0.82}},firstLabel)
  }catch(error){console.warn('3D buildings unavailable',error)}
}

function fitAll(){
  if(!map||!currentLocations.length)return
  if(currentLocations.length===1){
    const item=currentLocations[0]
    map.flyTo({center:[item.longitude,item.latitude],zoom:16.4,pitch:66,bearing:-28,duration:1200,curve:1.28,essential:true,padding:{top:50,right:25,bottom:105,left:25}})
    return
  }
  const MapLibre=(window as any).__familiaMapLibre;if(!MapLibre)return
  const bounds=new MapLibre.LngLatBounds();currentLocations.forEach(item=>bounds.extend([item.longitude,item.latitude]))
  map.fitBounds(bounds,{padding:{top:95,right:55,bottom:120,left:55},maxZoom:13.4,duration:1050})
}

function focus(item:MapLocation){
  if(!map)return
  map.flyTo({center:[item.longitude,item.latitude],zoom:17.2,pitch:70,bearing:-32,duration:1250,curve:1.35,essential:true,padding:{top:55,right:25,bottom:115,left:25}})
}

function renderPeople(){
  const root=document.querySelector<HTMLElement>('[data-map-people]');if(!root)return
  root.innerHTML=currentLocations.map(item=>`<button type=\"button\" class=\"family-map-chip${item.mine?' mine':''}\" data-map-member=\"${esc(item.member_id)}\"><span>${esc(item.name.charAt(0).toUpperCase())}</span>${esc(item.name)}</button>`).join('')
  root.querySelectorAll<HTMLButtonElement>('[data-map-member]').forEach(button=>button.addEventListener('click',()=>{const item=currentLocations.find(location=>location.member_id===button.dataset.mapMember);if(item)focus(item)}))
}

function renderMarkers(MapLibre:any){
  markers.forEach(marker=>{try{marker.remove()}catch{}});markers=[]
  currentLocations.forEach(item=>{
    const element=document.createElement('button');element.type='button';element.className=`family-map-marker${item.mine?' mine':''}`;element.setAttribute('aria-label',`Ver ubicación de ${item.name}`)
    element.innerHTML=`<span class=\"family-map-marker-dot\">${esc(item.name.charAt(0).toUpperCase())}</span><span class=\"family-map-marker-label\">${esc(item.name)}</span>`
    element.addEventListener('click',event=>{event.stopPropagation();focus(item);new MapLibre.Popup({offset:34,className:'family-map-popup',closeButton:true}).setLngLat([item.longitude,item.latitude]).setHTML(`<b>${esc(item.name)}${item.mine?' · tú':''}</b><small>${esc(age(item.updated_at))}${Number.isFinite(item.accuracy)?` · ±${Math.round(item.accuracy as number)} m`:''}</small>`).addTo(map)})
    markers.push(new MapLibre.Marker({element,anchor:'bottom'}).setLngLat([item.longitude,item.latitude]).addTo(map))
  });renderPeople()
}

async function refreshMap(){
  const page=document.querySelector<HTMLElement>('.location-page');if(!page)return
  const shell=ensurePanel(page);if(!shell)return
  const run=++generation;const loading=shell.querySelector<HTMLElement>('[data-map-loading]')
  try{
    const [MapLibre,locations]=await Promise.all([loadMapLibre(),fetchLocations()]);if(run!==generation||!document.contains(shell))return
    ;(window as any).__familiaMapLibre=MapLibre;currentLocations=locations
    if(!locations.length){if(loading){loading.hidden=false;loading.className='family-map-error';loading.innerHTML='<div><b>Aún no hay ubicaciones</b><span>Cuando alguien comparta su ubicación, aparecerá aquí.</span></div>'};return}
    if(!map){
      const mine=locations.find(item=>item.mine)||locations[0]
      map=new MapLibre.Map({container:shell.querySelector<HTMLElement>('[data-family-map-canvas]')!,style:MAP_STYLE,center:[mine.longitude,mine.latitude],zoom:locations.length===1?16:10.5,pitch:60,bearing:-24,maxPitch:80,attributionControl:false,canvasContextAttributes:{antialias:true}})
      map.addControl(new MapLibre.NavigationControl({showZoom:false,showCompass:true,visualizePitch:true}),'top-right');map.addControl(new MapLibre.AttributionControl({compact:true}),'bottom-right')
      map.on('load',()=>{add3dBuildings(map);renderMarkers(MapLibre);fitAll();if(loading)loading.hidden=true});map.on('error',(event:any)=>console.warn('Family map resource error',event?.error||event))
    }else{renderMarkers(MapLibre);fitAll();if(loading)loading.hidden=true;setTimeout(()=>{try{map.resize()}catch{}},40)}
  }catch(error){console.error('Family 3D map failed to load',error);if(loading){loading.hidden=false;loading.className='family-map-error';loading.innerHTML='<div><b>Mapa no disponible</b><span>La lista de ubicaciones sigue funcionando normalmente.</span></div>'}}
}

function scheduleRefresh(){if(refreshTimer!==null)clearTimeout(refreshTimer);refreshTimer=window.setTimeout(()=>{refreshTimer=null;void refreshMap()},160)}
function attachListObserver(){const list=document.querySelector('#familylocations');if(!list)return;listObserver?.disconnect();listObserver=new MutationObserver(scheduleRefresh);listObserver.observe(list,{childList:true,subtree:true})}
function scan(){const page=document.querySelector<HTMLElement>('.location-page');if(page===activePage)return;destroyMap();activePage=page;if(!page)return;ensurePanel(page);attachListObserver();scheduleRefresh()}

ensureAssets();pageObserver=new MutationObserver(scan);pageObserver.observe(document.body,{childList:true,subtree:true});scan()

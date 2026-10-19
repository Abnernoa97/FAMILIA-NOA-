import { getMemberId } from './core/identity'
import { mediaUrl, primeMedia } from './core/private-media'
import { getLocationState, refreshLocationState, subscribeLocationState, type LocationState } from './core/location-store'
import { refreshMemberLocation } from './core/location-device-sync'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE='https://tiles.openfreemap.org/styles/liberty'
const VECTOR_SOURCE='https://tiles.openfreemap.org/planet'
const ELEVATION_SOURCE='https://tiles.mapterhorn.com/tilejson.json'
const SCENE_PREFERENCES='familia-noa-cinematic-v1'
const prefersReducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false

type MapScene={threeD:boolean;night:boolean}
function savedScene():MapScene{
  try{
    const value=JSON.parse(localStorage.getItem(SCENE_PREFERENCES)||'{}')
    return {threeD:value.threeD!==false,night:value.night===true}
  }catch{return {threeD:true,night:false}}
}
let scene=savedScene()
function rememberScene(){
  try{localStorage.setItem(SCENE_PREFERENCES,JSON.stringify(scene))}catch{}
}
const lowMemory=Number((navigator as Navigator & {deviceMemory?:number}).deviceMemory||8)<4
let terrainUnavailable=false
let cardExpanded=true

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
let sceneLoaded=false
let advancedTerrainReady=false
let activePopup:any=null
let activePopupMemberId=''
let activeCardMemberId=''
let currentLocations:MapLocation[]=[]
let lastAvatarPaths=''
let lastLocationSignature=''
let activePage:Element|null=null
let pageObserver:MutationObserver|null=null
let stateUnsubscribe:(()=>void)|null=null
let resizeObserver:ResizeObserver|null=null
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
  if(document.getElementById('family-map-styles'))return
  const style=document.createElement('style')
  style.id='family-map-styles'
  style.textContent=`
  .family-map-shell{position:relative;height:min(62dvh,560px);min-height:420px;margin:14px 16px 18px;border-radius:32px;overflow:hidden;background:#e5e2d6;border:1px solid rgba(218,211,198,.9);box-shadow:0 22px 56px rgba(35,31,25,.14);isolation:isolate}.family-map-canvas{position:absolute;inset:0}.family-map-canvas .maplibregl-canvas{outline:none}.family-map-shell::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(12,12,12,.16),transparent 28%,transparent 62%,rgba(12,12,12,.42));z-index:2}
  .family-map-head{position:absolute;left:14px;right:14px;top:14px;z-index:4;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;pointer-events:none}.family-map-head>div{padding:10px 13px;border-radius:18px;background:rgba(250,248,242,.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 6px 22px #0001}.family-map-head small{display:block;font-size:8.5px;letter-spacing:.16em;font-weight:800;color:#77736b}.family-map-head b{display:block;margin-top:2px;font:500 19px var(--display-font,Georgia,serif);color:#171716}.family-map-actions{display:flex;gap:7px;pointer-events:auto}.family-map-all,.family-map-mine{height:42px;padding:0 14px;border:0;border-radius:21px;font-weight:750;font-size:11px;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 6px 18px #0002}.family-map-all{background:rgba(23,23,22,.92);color:#fff}.family-map-mine{background:rgba(250,248,242,.92);color:#171716}
  .family-map-people{position:absolute;z-index:4;left:10px;right:10px;bottom:10px;display:flex;gap:7px;overflow-x:auto;padding:2px 2px max(2px,env(safe-area-inset-bottom));scrollbar-width:none}.family-map-people::-webkit-scrollbar{display:none}.family-map-chip{flex:0 0 auto;display:grid;grid-template-columns:31px auto;grid-template-rows:auto auto;column-gap:8px;align-items:center;min-height:48px;padding:5px 12px 5px 6px;border:1px solid rgba(255,255,255,.45);border-radius:25px;background:rgba(250,248,242,.94);color:#171716;font-size:11.5px;font-weight:750;text-align:left;box-shadow:0 6px 20px #0002;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.family-map-chip small{grid-column:2;display:block;margin-top:-1px;color:#807b73;font-size:8.5px;font-weight:650}.family-map-chip-avatar{grid-row:1/3;width:31px;height:31px;flex:0 0 31px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#e8e1d4;font-size:11px}.family-map-chip-avatar img{width:100%;height:100%;object-fit:cover;display:block}.family-map-chip.mine{background:rgba(23,23,22,.94);color:#fff;border-color:rgba(23,23,22,.92)}.family-map-chip.mine small{color:#bdb8af}.family-map-chip.mine .family-map-chip-avatar{background:#fff;color:#171716}
  .family-map-marker{position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 5px 10px rgba(0,0,0,.28));cursor:pointer;border:0;background:transparent;padding:0}.family-map-marker-dot{position:relative;width:48px;height:48px;border:3px solid #fff;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#4c367f;color:#fff;font-weight:800;font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,.22)}.family-map-marker.fresh .family-map-marker-dot::before{content:"";position:absolute;inset:-9px;border:2px solid rgba(73,157,105,.4);border-radius:50%;animation:familyLocationPulse 2s ease-out infinite;pointer-events:none}@keyframes familyLocationPulse{0%{transform:scale(.72);opacity:.85}100%{transform:scale(1.35);opacity:0}}.family-map-marker-dot img{width:100%;height:100%;object-fit:cover;display:block}.family-map-marker.mine .family-map-marker-dot{background:#171716}.family-map-marker::after{content:"";width:3px;height:12px;border-radius:3px;background:#fff;margin-top:-1px}.family-map-marker-label{margin-top:3px;padding:4px 7px;border-radius:9px;background:rgba(23,23,22,.86);color:#fff;font-size:9px;font-weight:700;white-space:nowrap}
  .family-map-loading,.family-map-error{position:absolute;inset:0;z-index:6;display:grid;place-items:center;padding:30px;text-align:center;background:linear-gradient(145deg,#d9d3c7,#f2eee6);color:#5f5a52;font-size:13px}.family-map-error b{display:block;color:#171716;font:500 22px var(--display-font,Georgia,serif);margin-bottom:7px}.family-map-loading[hidden],.family-map-error[hidden],[data-map-loading][hidden]{display:none!important}.family-map-popup .maplibregl-popup-content{border-radius:16px;padding:12px 14px;box-shadow:0 12px 34px #0003;font-family:system-ui,sans-serif}.family-map-popup b{display:block;font-size:13px}.family-map-popup small{display:block;margin-top:3px;color:#77736b}.family-map-popup .maplibregl-popup-close-button{font-size:18px;padding:2px 7px}.family-map-shell .maplibregl-ctrl-attrib{font-size:9px;background:rgba(255,255,255,.75)}.family-map-shell .maplibregl-ctrl-group{border-radius:14px;overflow:hidden;box-shadow:0 5px 18px #0002}
  @media(max-width:480px){.family-map-shell{height:55dvh;min-height:410px;margin:10px 12px 16px;border-radius:28px}.family-map-head{left:10px;right:10px;top:10px}.family-map-head>div{padding:9px 11px}.family-map-head b{font-size:17px}.family-map-all,.family-map-mine{height:39px;padding:0 12px}.family-map-people{bottom:9px;left:7px;right:7px}.family-map-marker-label{display:none}}

  /* CINEMATIC 3D G1: warm colored city, floating controls and member sheet */
  .family-map-shell{background:#e5e2d6;border:1px solid rgba(250,235,213,.65);box-shadow:0 24px 52px rgba(23,38,34,.19)}
  .family-map-shell::after{background:linear-gradient(180deg,rgba(22,34,35,.4),transparent 26%,transparent 60%,rgba(20,28,29,.28))}
  .family-map-head>div{background:rgba(255,251,243,.93);border:1px solid rgba(255,255,255,.58)}
  .family-map-scene-controls{position:absolute;z-index:5;right:10px;top:88px;display:flex;flex-direction:column;gap:9px}
  .family-map-scene-button{width:46px;height:46px;border-radius:50%;border:1px solid #ffffff9c;background:rgba(24,34,36,.85);color:#fff;font:800 11px system-ui;box-shadow:0 6px 22px #0003;backdrop-filter:blur(13px);-webkit-backdrop-filter:blur(13px)}
  .family-map-scene-button[aria-pressed="true"]{background:#fff9e8;color:#24392f;border-color:#fff}
  .family-map-shell.has-selected .family-map-people{opacity:0;pointer-events:none}
  .family-map-detail{position:absolute;bottom:12px;left:11px;right:11px;z-index:6;max-height:min(44dvh,296px);overflow:auto;padding:9px 15px 13px;border:1px solid rgba(255,255,255,.9);border-radius:26px;background:rgba(255,251,245,.97);color:#262923;box-shadow:0 14px 40px #0004;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);font-family:system-ui,sans-serif}
  .family-map-detail[hidden],.family-map-detail-body[hidden]{display:none!important}
  .family-map-detail-grab{width:36px;height:4px;border-radius:3px;background:#c9c4bb;margin:0 auto 9px}
  .family-map-detail-top{display:flex;gap:11px;align-items:center}
  .family-map-detail-avatar{width:48px;height:48px;flex:0 0 48px;overflow:hidden;border-radius:50%;display:grid;place-items:center;background:#253e35;color:white;border:3px solid #fff;box-shadow:0 2px 11px #0002;font-weight:800}
  .family-map-detail-avatar img{width:100%;height:100%;object-fit:cover}
  .family-map-detail-info{flex:1;min-width:0}.family-map-detail-info b{display:block;font-size:15px;line-height:1.35}.family-map-detail-info small{display:block;font-size:10px;color:#77766d;margin-top:3px}
  .family-map-status{display:inline-flex;align-items:center;gap:4px;border-radius:8px;background:#d5eedd;color:#1d663e;padding:3px 7px;font-weight:800;font-size:9px}
  .family-map-status.old{background:#f2e5ce;color:#8c6025}
  .family-map-card-icon{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border-radius:50%;border:0;background:#ede9df;color:#403e38;font-size:20px}
  .family-map-detail-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:13px 0 10px}
  .family-map-detail-stat{padding:10px 11px;border-radius:14px;background:#f3efe7}.family-map-detail-stat small{display:block;font-size:9px;color:#807b71}.family-map-detail-stat b{display:block;margin-top:3px;font-size:12px;color:#2d312a}
  .family-map-detail-actions{display:flex;gap:8px}.family-map-detail-action{flex:1;border:0;border-radius:13px;background:#263b34;color:#fff;font-size:11px;font-weight:750;padding:12px 10px}
  .family-map-detail-action.secondary{background:#eae5da;color:#2d352e}
  .family-map-shell.has-selected .maplibregl-ctrl-bottom-right{bottom:200px}
  .family-map-shell.has-selected.card-collapsed .maplibregl-ctrl-bottom-right{bottom:85px}
  .family-map-marker-dot{border-color:#fff7e9;box-shadow:0 0 0 3px rgba(48,124,99,.5),0 7px 20px #101f1a61}
  .family-map-marker.fresh .family-map-marker-dot{box-shadow:0 0 0 3px rgba(40,171,116,.65),0 0 24px rgba(63,198,135,.6)}
  .family-map-marker-label{background:rgba(26,39,36,.87);padding:5px 9px}
  .family-map-shell .maplibregl-ctrl-attrib{font-size:9px}
  @media(max-width:480px){.family-map-scene-controls{top:81px;right:9px}.family-map-scene-button{width:41px;height:41px}.family-map-detail{left:8px;right:8px;bottom:8px}.family-map-shell.has-selected .maplibregl-ctrl-bottom-right{bottom:205px}}
  @media(prefers-reduced-motion:reduce){.family-map-marker.fresh .family-map-marker-dot::before{animation:none}}
  `
  document.head.appendChild(style)
}

function loadMapLibre(){
  ensureAssets()
  if(!maplibrePromise)maplibrePromise=import('maplibre-gl')
    .catch(error=>{maplibrePromise=null;throw error})
  return maplibrePromise
}

function clearMarkers(){
  markers.forEach(marker=>{try{marker.remove()}catch{}})
  markers.clear()
  const people=document.querySelector<HTMLElement>('[data-map-people]')
  if(people)people.innerHTML=''
}

function destroyMap(){
  generation++
  sceneLoaded=false
  advancedTerrainReady=false
  resizeObserver?.disconnect()
  resizeObserver=null
  clearMarkers()
  currentLocations=[]
  lastAvatarPaths=''
  lastLocationSignature=''
  if(activePopup){try{activePopup.remove()}catch{}}
  activePopup=null
  activePopupMemberId=''
  closeDetailsCard()
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
  shell.innerHTML=`<div class="family-map-canvas" data-family-map-canvas></div><div class="family-map-head"><div><small>CINEMATIC 3D · FAMILIA NOA</small><b data-map-title>Tu familia en vivo</b></div><div class="family-map-actions"><button type="button" class="family-map-mine" data-map-mine>Yo</button><button type="button" class="family-map-all" data-map-all>Todos</button></div></div><div class="family-map-scene-controls"><button type="button" class="family-map-scene-button" data-map-3d aria-label="Activar o desactivar vista tridimensional">3D</button><button type="button" class="family-map-scene-button" data-map-night aria-label="Cambiar iluminación de día y noche">☾</button></div><div class="family-map-people" data-map-people></div><div class="family-map-detail" data-map-card hidden></div><div class="family-map-loading" data-map-loading>Preparando ciudad cinematográfica…</div>`
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
  shell.querySelector<HTMLButtonElement>('[data-map-3d]')?.addEventListener('click',()=>{
    scene.threeD=!scene.threeD
    rememberScene()
    applyCinematicScene(map)
    updateSceneButtons()
    if(map)map.easeTo({pitch:scene.threeD?52:0,bearing:scene.threeD?-24:0,duration:prefersReducedMotion?0:600})
  })
  shell.querySelector<HTMLButtonElement>('[data-map-night]')?.addEventListener('click',()=>{
    scene.night=!scene.night
    rememberScene()
    applyCinematicScene(map)
    updateSceneButtons()
  })
  shell.querySelector('[data-map-card]')?.addEventListener('click',event=>{
    const action=(event.target as Element).closest<HTMLButtonElement>('[data-card-action]')?.dataset.cardAction
    if(!action)return
    if(action==='close'){
      closeDetailsCard()
      if(activePopup)activePopup.remove()
      return
    }
    if(action==='toggle'){
      cardExpanded=!cardExpanded
      const current=currentLocations.find(location=>location.member_id===activeCardMemberId)
      if(current)renderDetailsCard(current)
      return
    }
    if(action==='focus'){
      const item=currentLocations.find(location=>location.member_id===activeCardMemberId)
      if(item)focus(item,false)
    }
  })
  updateSceneButtons()
  return shell
}

function locationsFromState(state:LocationState):MapLocation[]{
  const me=getMemberId()
  const names=new Map(state.members.map(member=>[member.id,member.name]))
  const profileMap=new Map(state.profiles.map(profile=>[profile.member_id,profile.avatar_path]))
  // Never wait for private-photo authorization to place a family's coordinates.
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

function hydrateAvatars(locations:MapLocation[]){
  const paths=Array.from(new Set(locations.map(item=>item.avatarPath).filter((x):x is string=>!!x))).sort()
  const key=paths.join('|')
  if(!key||key===lastAvatarPaths)return
  lastAvatarPaths=key
  void primeMedia(paths).then(()=>{
    if(lastAvatarPaths!==key)return
    let changed=false
    currentLocations=currentLocations.map(item=>{
      const url=mediaUrl(item.avatarPath)
      if(!url||url===item.avatarUrl)return item
      changed=true
      return {...item,avatarUrl:url}
    })
    if(changed&&map&&sceneLoaded){
      const MapLibre=(window as any).__familiaMapLibre
      if(MapLibre)renderMarkers(MapLibre)
      syncActivePopup()
    }
  }).catch(error=>console.warn('Family avatar loading unavailable',error))
}

/** Reuse OpenFreeMap's vector source; adding a duplicate downloads the same city twice. */
function cityVectorSource(instance:any):string{
  const sources=instance.getStyle()?.sources||{}
  const candidates=Object.entries(sources) as Array<[string,any]>
  const base=candidates.find(([key,source])=>
    source?.type==='vector' && /openmaptiles|openfreemap|planet/i.test(key+' '+String(source?.url||'')))
    ||candidates.find(([,source])=>source?.type==='vector')
  if(base)return base[0]
  const fallback='familia-openfreemap'
  if(!instance.getSource(fallback))instance.addSource(fallback,{type:'vector',url:VECTOR_SOURCE})
  return fallback
}

function add3dBuildings(instance:any){
  try{
    const sourceId=cityVectorSource(instance)
    if(instance.getLayer('familia-buildings-3d'))return
    const layers=instance.getStyle()?.layers||[]
    const firstLabel=layers.find((layer:any)=>layer.type==='symbol'&&layer.layout?.['text-field'])?.id
    instance.addLayer({
      id:'familia-buildings-3d',
      source:sourceId,
      'source-layer':'building',
      type:'fill-extrusion',
      minzoom:12.5,
      filter:['!=',['get','hide_3d'],true],
      paint:{
        // The source provides real OSM footprints and available building heights.
        // Side gradients plus directional MapLibre light add material-like depth
        // without textures, paid imagery or additional geometry.
        'fill-extrusion-color':'#d9c6a9',
        'fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],7],
        'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
        'fill-extrusion-opacity':0.96,
        'fill-extrusion-vertical-gradient':true,
      },
    },firstLabel)
  }catch(error){
    console.warn('3D buildings unavailable',error)
  }
}

function updateSceneButtons(){
  const threeD=document.querySelector<HTMLButtonElement>('[data-map-3d]')
  const night=document.querySelector<HTMLButtonElement>('[data-map-night]')
  if(threeD){
    threeD.textContent=scene.threeD?'3D':'2D'
    threeD.setAttribute('aria-pressed',String(scene.threeD))
    threeD.title=scene.threeD?'Cambiar a vista plana':'Activar vista 3D'
  }
  if(night){
    night.textContent=scene.night?'☀':'☾'
    night.setAttribute('aria-pressed',String(scene.night))
    night.title=scene.night?'Cambiar a luz de día':'Activar iluminación nocturna'
  }
}

/** OpenFreeMap tiles stay the single cartographic source; this changes only their presentation. */
function applyCinematicScene(instance:any){
  // A loaded style accepts updates even while its tiles remain pending.
  // isStyleLoaded() would suppress cinematic colors during routine source loads.
  if(!instance||!sceneLoaded)return
  const night=scene.night
  // Restrained natural palette: water, greenery and street hierarchy remain
  // legible. We keep unknown Liberty style layers unchanged.
  const palette=night?{
    ground:'#182a31',water:'#17495c',park:'#244f45',nature:'#304c43',
    built:'#334249',roads:'#c9955d',localRoads:'#637c78',minorRoads:'#475e5e',
    labels:'#f1e9d8',halo:'#243239',
    short:'#746c65',mid:'#988476',tall:'#aeb2b1',tower:'#b7bbb9',
    streetEdge:'#2b4145',streetSurface:'#d8a56a',lane:'#82908b',
  }:{
    ground:'#e9e1d2',water:'#528c9a',park:'#8da98a',nature:'#b3c19b',
    built:'#dfd5c2',roads:'#fff5e3',localRoads:'#f0e3cd',minorRoads:'#e3d8c2',
    labels:'#44534d',halo:'#f6f0e2',
    short:'#d7c4a8',mid:'#c5b197',tall:'#aeb1ae',tower:'#92a5a3',
    streetEdge:'#b6a993',streetSurface:'#fff6e7',lane:'#efddc1',
  }
  // This runs on explicit day/night changes, not on every GPS update.
  for(const layer of instance.getStyle()?.layers||[]){
    const name=String(layer.id||'').toLowerCase()
    if(name.startsWith('familia-'))continue
    const group=String(layer['source-layer']||'').toLowerCase()
    const isWater=group==='water'||/(^water|lake|ocean|sea)/.test(name)
    const isPark=/(park|wood|forest|grass|garden)/.test(name)||/(park|grass)/.test(group)
    const isNature=/(landcover|landuse)/.test(group)||/(landcover|nature)/.test(name)
    const isRoad=group==='transportation'||/(road|street|highway|motorway|bridge|tunnel)/.test(name)
    try{
      if(layer.type==='background'){
        instance.setPaintProperty(layer.id,'background-color',palette.ground)
      }else if(layer.type==='fill'){
        // Do not repaint unrecognized features: their original styling
        // contains useful context (buildings, airports, water details).
        const fill=isWater?palette.water:isPark?palette.park:isNature?palette.nature:
          isRoad?palette.localRoads:null
        if(fill)instance.setPaintProperty(layer.id,'fill-color',fill)
      }else if(layer.type==='line'){
        if(isRoad){
          instance.setPaintProperty(layer.id,'line-color',[
            'match',['get','class'],
            ['motorway','trunk','primary'],palette.roads,
            ['secondary','tertiary'],palette.localRoads,
            palette.minorRoads,
          ])
        }else if(isWater){
          instance.setPaintProperty(layer.id,'line-color',palette.water)
        }
      }else if(layer.type==='symbol'&&layer.layout?.['text-field']){
        instance.setPaintProperty(layer.id,'text-color',palette.labels)
        instance.setPaintProperty(layer.id,'text-halo-color',palette.halo)
      }
    }catch(error){
      console.warn('Cinematic layer paint unavailable',layer.id,error)
    }
  }
  try{
    // Real source geometry has shadows and side gradient, not fake facades.
    instance.setLight({
      anchor:'map',
      position:[1.5,night?225:148,night?44:53],
      color:night?'#e7c69d':'#fff6de',
      intensity:night?0.62:0.86,
    })
  }catch(error){console.warn('Cinematic lighting unavailable',error)}
  try{
    instance.setSky({
      'sky-color':night?'#1b303f':'#aebdc4',
      'horizon-color':night?'#465e6a':'#ccd0c2',
      'fog-color':night?'#273b49':'#d5d8ca',
      'sky-horizon-blend':0.38,
      'horizon-fog-blend':0.24,
      'fog-ground-blend':0.14,
    })
  }catch(error){console.warn('Cinematic atmosphere unavailable',error)}
  try{
    if(instance.getLayer('familia-buildings-3d')){
      instance.setLayoutProperty('familia-buildings-3d','visibility',scene.threeD?'visible':'none')
      instance.setPaintProperty('familia-buildings-3d','fill-extrusion-color',[
        'interpolate',['linear'],['coalesce',['get','render_height'],['get','height'],7],
        0,palette.short,18,palette.mid,60,palette.tall,180,palette.tower,
      ])
      instance.setPaintProperty('familia-buildings-3d','fill-extrusion-opacity',night?0.93:0.97)
      instance.setPaintProperty('familia-buildings-3d','fill-extrusion-vertical-gradient',true)
    }
    if(instance.getLayer('familia-cine-street-edge')){
      instance.setPaintProperty('familia-cine-street-edge','line-color',palette.streetEdge)
      instance.setPaintProperty('familia-cine-street-edge','line-opacity',night?0.64:0.46)
    }
    if(instance.getLayer('familia-cine-arterials')){
      instance.setPaintProperty('familia-cine-arterials','line-color',palette.streetSurface)
      instance.setPaintProperty('familia-cine-arterials','line-opacity',night?0.88:0.81)
    }
    if(instance.getLayer('familia-cine-lanes')){
      instance.setPaintProperty('familia-cine-lanes','line-color',palette.lane)
      instance.setPaintProperty('familia-cine-lanes','line-opacity',night?0.62:0.57)
    }
  }catch(error){console.warn('Cinematic city material unavailable',error)}

  // Terrain is deferred until the FIRST base-map frame has settled.
  // It must never hold back the map, avatars or street tiles.
  if(advancedTerrainReady)syncTerrain(instance)
}

function syncTerrain(instance:any){
  if(!instance)return
  if(scene.threeD&&!lowMemory&&!terrainUnavailable){
    try{
      if(!instance.getSource('familia-cinematic-dem')){
        instance.addSource('familia-cinematic-dem',{
          type:'raster-dem',url:ELEVATION_SOURCE,tileSize:512,encoding:'terrarium',
          attribution:'© <a href="https://mapterhorn.com/attribution">Mapterhorn</a>',
        })
      }
      if(!instance.getTerrain?.())instance.setTerrain({source:'familia-cinematic-dem',exaggeration:1.1})
    }catch(error){
      terrainUnavailable=true
      console.warn('Optional terrain unavailable; map remains usable',error)
      try{instance.setTerrain(null)}catch{}
    }
  }else{
    try{if(instance.getTerrain?.())instance.setTerrain(null)}catch{}
  }
}

function addCinematicStreets(instance:any){
  if(instance.getLayer('familia-cine-arterials'))return
  const sourceId=cityVectorSource(instance)
  try{
    // Insert road materials below place labels to preserve cartographic clarity.
    const firstLabel=instance.getStyle()?.layers?.find((layer:any)=>
      layer.type==='symbol'&&layer.layout?.['text-field'])?.id
    const major=['match',['get','class'],['motorway','trunk','primary'],true,false]
    const local=['match',['get','class'],['secondary','tertiary','minor','residential','service'],true,false]
    instance.addLayer({
      id:'familia-cine-street-edge',
      source:sourceId,'source-layer':'transportation',
      type:'line',minzoom:12.5,filter:major,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{
        'line-color':'#b6a993',
        'line-width':['interpolate',['linear'],['zoom'],12.5,1.2,15,3.5,18,8],
        'line-opacity':0.46,
      },
    },firstLabel)
    instance.addLayer({
      id:'familia-cine-arterials',
      source:sourceId,'source-layer':'transportation',
      type:'line',minzoom:12.5,filter:major,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{
        'line-color':'#fff6e7',
        'line-width':['interpolate',['linear'],['zoom'],12.5,0.6,15,2.1,18,5.5],
        'line-opacity':0.81,
      },
    },firstLabel)
    // At neighborhood zoom, smaller streets acquire a fine warm outline.
    // Keep them invisible from afar to avoid GPU overhead and visual noise.
    instance.addLayer({
      id:'familia-cine-lanes',
      source:sourceId,'source-layer':'transportation',
      type:'line',minzoom:14.5,filter:local,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{
        'line-color':'#efddc1',
        'line-width':['interpolate',['linear'],['zoom'],14.5,0.4,17,1.35,19,2.25],
        'line-opacity':0.57,
      },
    },firstLabel)
  }catch(error){
    console.warn('Cinematic street materials unavailable',error)
  }
}

function distanceKm(a:MapLocation,b:MapLocation){
  const rad=Math.PI/180
  const dLat=(b.latitude-a.latitude)*rad
  const dLng=(b.longitude-a.longitude)*rad
  const h=Math.sin(dLat/2)**2+
    Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dLng/2)**2
  return 12742*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)))
}

/** The default camera shows a real family member, not empty space between cities. */
function showFamilyOnOpen(){
  if(!map||!currentLocations.length)return
  const mine=currentLocations.find(item=>item.mine)
  const freshest=[...currentLocations].sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at))[0]
  const item=mine||freshest
  const title=document.querySelector<HTMLElement>('[data-map-title]')
  if(title)title.textContent='Tu familia en vivo'
  map.flyTo({
    center:[item.longitude,item.latitude],
    zoom:scene.threeD?16.5:16,
    pitch:scene.threeD?52:0,
    bearing:scene.threeD?-24:0,
    duration:prefersReducedMotion?0:900,
    essential:true,
    padding:{top:95,right:40,bottom:150,left:40},
  })
}

/** 'Todos' is a deliberate overview; wide distances should never show a tilted horizon. */
function fitAll(){
  if(!map||!currentLocations.length)return
  if(currentLocations.length===1){
    const item=currentLocations[0]
    map.flyTo({
      center:[item.longitude,item.latitude],
      zoom:16.5,pitch:scene.threeD?52:0,bearing:scene.threeD?-24:0,
      duration:prefersReducedMotion?0:850,
      essential:true,
      padding:{top:90,right:30,bottom:activeCardMemberId?230:125,left:30},
    })
    return
  }
  const MapLibre=(window as any).__familiaMapLibre
  if(!MapLibre)return
  const bounds=new MapLibre.LngLatBounds()
  currentLocations.forEach(item=>bounds.extend([item.longitude,item.latitude]))
  let spreadKm=0
  for(let i=0;i<currentLocations.length;i++){
    for(let j=i+1;j<currentLocations.length;j++){
      spreadKm=Math.max(spreadKm,distanceKm(currentLocations[i],currentLocations[j]))
    }
  }
  // A steep camera clips distant markers behind the horizon. Keep 3D only locally.
  const pitch=!scene.threeD?0:spreadKm>5?0:spreadKm>1?25:43
  const bearing=scene.threeD&&spreadKm<=1?-16:0
  map.fitBounds(bounds,{
    padding:{top:110,right:52,bottom:activeCardMemberId?235:140,left:52},
    maxZoom:spreadKm<=1?16:13.7,
    pitch,bearing,
    duration:prefersReducedMotion?0:1000,
    essential:true,
  })
}

function popupHtml(item:MapLocation){
  return `<b>${esc(item.name)}${item.mine?' · tú':''}</b><small>${esc(age(item.updated_at))}${Number.isFinite(item.accuracy)?` · ±${Math.round(item.accuracy as number)} m`:''}</small>`
}

function closeDetailsCard(){
  activeCardMemberId=''
  const card=document.querySelector<HTMLElement>('[data-map-card]')
  if(card)card.hidden=true
  const shell=document.querySelector<HTMLElement>('[data-family-map]')
  shell?.classList.remove('has-selected','card-collapsed')
}

function renderDetailsCard(item:MapLocation){
  const card=document.querySelector<HTMLElement>('[data-map-card]')
  const shell=document.querySelector<HTMLElement>('[data-family-map]')
  if(!card||!shell)return
  activeCardMemberId=item.member_id
  const elapsed=Date.now()-new Date(item.updated_at).getTime()
  const fresh=Number.isFinite(elapsed)&&elapsed>=0&&elapsed<5*60*1000
  const accuracy=Number.isFinite(item.accuracy)?'±'+Math.round(item.accuracy as number)+' m':'Sin dato'
  const label=esc(item.name)+(item.mine?' · tú':'')
  const status=fresh?'Ahora':'Última ubicación'
  card.hidden=false
  shell.classList.add('has-selected')
  shell.classList.toggle('card-collapsed',!cardExpanded)
  card.innerHTML=
    '<div class="family-map-detail-grab"></div>'+
    '<div class="family-map-detail-top">'+
      '<span class="family-map-detail-avatar">'+avatarMarkup(item)+'</span>'+
      '<div class="family-map-detail-info"><b>'+label+'</b>'+
      '<span class="family-map-status'+(fresh?'':' old')+'">'+status+'</span>'+
      '<small>'+esc(age(item.updated_at))+' · '+accuracy+'</small></div>'+
      '<button type="button" class="family-map-card-icon" data-card-action="toggle" aria-label="'+(cardExpanded?'Reducir':'Ampliar')+' tarjeta" aria-expanded="'+String(cardExpanded)+'">'+(cardExpanded?'⌄':'⌃')+'</button>'+
      '<button type="button" class="family-map-card-icon" data-card-action="close" aria-label="Cerrar tarjeta">×</button>'+
    '</div>'+
    '<div class="family-map-detail-body" '+(cardExpanded?'':'hidden')+'>'+
      '<div class="family-map-detail-meta">'+
        '<div class="family-map-detail-stat"><small>PRECISIÓN</small><b>'+accuracy+'</b></div>'+
        '<div class="family-map-detail-stat"><small>ACTUALIZACIÓN</small><b>'+esc(age(item.updated_at))+'</b></div>'+
      '</div>'+
      '<div class="family-map-detail-actions">'+
        '<button type="button" class="family-map-detail-action" data-card-action="focus">⌖  Centrar en el mapa</button>'+
        '<button type="button" class="family-map-detail-action secondary" data-card-action="toggle">Reducir</button>'+
      '</div>'+
    '</div>'
  bindAvatarFallback(card)
}

function syncActivePopup(){
  if(activeCardMemberId){
    const cardItem=currentLocations.find(location=>location.member_id===activeCardMemberId)
    if(cardItem)renderDetailsCard(cardItem)
    else closeDetailsCard()
  }
  if(!map||!activePopup||!activePopupMemberId)return
  const item=currentLocations.find(location=>location.member_id===activePopupMemberId)
  if(!item)return
  activePopup
    .setLngLat([item.longitude,item.latitude])
    .setHTML(popupHtml(item))
}

function focus(item:MapLocation,showPopup=false){
  if(!map)return
  map.flyTo({center:[item.longitude,item.latitude],zoom:16.9,pitch:scene.threeD?54:0,bearing:scene.threeD?-24:0,duration:prefersReducedMotion?0:1050,curve:1.38,essential:true,padding:{top:65,right:25,bottom:showPopup?245:cardExpanded?245:130,left:25}})
  const title=document.querySelector<HTMLElement>('[data-map-title]')
  if(title)title.textContent=item.mine?'Tu ubicación':item.name
  document.querySelectorAll<HTMLElement>('.family-map-chip').forEach(chip=>chip.classList.toggle('selected',chip.dataset.mapMember===item.member_id))
  if(showPopup){
    if(activeCardMemberId!==item.member_id)cardExpanded=true
    renderDetailsCard(item)
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
  // Keep one DOM marker per person: GPS updates change coordinates in place.
  const ids=new Set(currentLocations.map(item=>item.member_id))
  for(const [id,marker] of markers){
    if(ids.has(id))continue
    try{marker.remove()}catch{}
    markers.delete(id)
  }
  for(const item of currentLocations){
    const fresh=Date.now()-new Date(item.updated_at).getTime()<5*60*1000
    const className=`family-map-marker${item.mine?' mine':''}${fresh?' fresh':''}`
    const signature=[item.name,item.avatarUrl,item.mine].join('|')
    let marker=markers.get(item.member_id)
    let element:HTMLButtonElement
    if(marker){
      element=marker.getElement() as HTMLButtonElement
      const lastPosition=marker.getLngLat()
      if(Math.abs(lastPosition.lng-item.longitude)>0.0000001||Math.abs(lastPosition.lat-item.latitude)>0.0000001){
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
        const current=currentLocations.find(location=>location.member_id===item.member_id)
        if(!current)return
        focus(current,true)
        void refreshMemberLocation(current.member_id)
      })
    }
    element.className=className
    element.setAttribute('aria-label',`Ver ubicación de ${item.name}`)
    if(element.dataset.contentSignature!==signature){
      element.dataset.contentSignature=signature
      element.innerHTML=`<span class="family-map-marker-dot">${avatarMarkup(item)}</span><span class="family-map-marker-label">${esc(item.name)}</span>`
      bindAvatarFallback(element)
    }
  }
  renderPeople()
}

function showOverlay(shell:HTMLElement,kind:'loading'|'empty'|'error'){
  const overlay=shell.querySelector<HTMLElement>('[data-map-loading]')
  if(!overlay)return
  overlay.hidden=false
  if(kind==='loading'){
    overlay.className='family-map-loading'
    overlay.textContent='Preparando ciudad cinematográfica…'
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

  const locations=locationsFromState(state)
  if(run!==generation||!document.contains(shell))return
  const signature=locations
    .map(item=>[item.member_id,item.latitude.toFixed(6),item.longitude.toFixed(6),item.updated_at,item.avatarPath||''].join(':'))
    .sort()
    .join('|')
  const changed=signature!==lastLocationSignature
  currentLocations=locations
  hydrateAvatars(locations)

  if(!locations.length){
    lastLocationSignature=''
    clearMarkers()
    closeDetailsCard()
    showOverlay(shell,'empty')
    return
  }

  // Retain the newest Supabase snapshot while the map's base style loads.
  // Initial map.on('load') consumes currentLocations instead of an older closure.
  if(map&&!sceneLoaded)return

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
        zoom:16,
        pitch:scene.threeD?50:0,
        bearing:scene.threeD?-24:0,
        maxPitch:80,
        attributionControl:false,
        canvasContextAttributes:{antialias:true},
      })
      map.addControl(new MapLibre.NavigationControl({showZoom:false,showCompass:true,visualizePitch:true}),'top-right')
      map.addControl(new MapLibre.AttributionControl({compact:true}),'bottom-right')
      if('ResizeObserver' in window){
        resizeObserver?.disconnect()
        resizeObserver=new ResizeObserver(()=>{try{map?.resize()}catch{}})
        resizeObserver.observe(shell)
      }
      map.on('load',()=>{
        sceneLoaded=true
        add3dBuildings(map)
        addCinematicStreets(map)
        applyCinematicScene(map)
        renderMarkers(MapLibre)
        syncActivePopup()
        lastLocationSignature=currentLocations
          .map(item=>[item.member_id,item.latitude.toFixed(6),item.longitude.toFixed(6),item.updated_at,item.avatarPath||''].join(':'))
          .sort().join('|')
        showFamilyOnOpen()
        hideOverlay(shell)
        // Optional elevation work starts only after the base map is truly idle.
        // A slow terrain server must never block the first usable map frame.
        const instance=map
        instance.once('idle',()=>{
          if(map!==instance||!sceneLoaded||lowMemory)return
          advancedTerrainReady=true
          syncTerrain(instance)
        })
      })
      map.on('error',(event:any)=>{
         if(event?.sourceId==='familia-cinematic-dem'){
           terrainUnavailable=true
           try{map?.setTerrain(null)}catch{}
           console.warn('Optional terrain unavailable; 3D city remains active',event?.error||event)
           return
         }
         console.warn('Family map resource error',event?.error||event)
       })
      return
    }

    renderMarkers(MapLibre)
    syncActivePopup()
    lastLocationSignature=signature
    // Update membership without moving a map that the user is exploring.
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
  // Load the map engine while Supabase data is fetched (never after photo signing).
  void loadMapLibre().catch(error=>console.warn('Map engine preloading failed',error))
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

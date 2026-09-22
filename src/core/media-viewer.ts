import { backView, currentView, enterView } from './navigation'

type MediaItem = { src:string; alt?:string; type?:'image'|'video' }

let overlay:HTMLElement|null=null
let items:MediaItem[]=[]
let index=0
let closeHandler:(()=>void)|null=null

function pauseOtherVideos(active?:HTMLVideoElement|null){
  document.querySelectorAll<HTMLVideoElement>('video').forEach(video=>{
    if(video!==active&&!video.paused){
      try{video.pause()}catch{}
    }
  })
}

function ensure(){
  if(overlay?.isConnected)return overlay
  overlay=document.createElement('div')
  overlay.className='family-media-viewer'
  overlay.hidden=true
  overlay.innerHTML='<div class="family-media-stage"><button type="button" class="family-media-close" aria-label="Cerrar">×</button><button type="button" class="family-media-prev" aria-label="Anterior">‹</button><img class="family-media-image" alt=""><video class="family-media-video" playsinline preload="metadata" hidden></video><button type="button" class="family-media-next" aria-label="Siguiente">›</button><div class="family-media-count"></div></div>'
  document.body.appendChild(overlay)

  overlay.querySelector('.family-media-close')?.addEventListener('click',()=>{
    if(currentView()==='media')backView()
    else closeMediaViewer()
  })
  overlay.querySelector('.family-media-prev')?.addEventListener('click',()=>show(index-1))
  overlay.querySelector('.family-media-next')?.addEventListener('click',()=>show(index+1))
  overlay.addEventListener('click',e=>{
    if(e.target!==overlay)return
    if(currentView()==='media')backView()
    else closeMediaViewer()
  })

  const viewerVideo=overlay.querySelector<HTMLVideoElement>('.family-media-video')!
  viewerVideo.addEventListener('click',event=>{
    event.stopPropagation()
    if(viewerVideo.ended)viewerVideo.currentTime=0
    if(viewerVideo.paused){
      pauseOtherVideos(viewerVideo)
      void viewerVideo.play().catch(()=>{})
    }else viewerVideo.pause()
  })
  viewerVideo.addEventListener('play',()=>pauseOtherVideos(viewerVideo))

  let sx=0,sy=0
  overlay.addEventListener('touchstart',e=>{const t=e.changedTouches[0];sx=t.clientX;sy=t.clientY},{passive:true})
  overlay.addEventListener('touchend',e=>{const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2)show(index+(dx<0?1:-1))},{passive:true})
  return overlay
}

function resetViewerMedia(root:HTMLElement){
  const image=root.querySelector<HTMLImageElement>('.family-media-image')!
  const video=root.querySelector<HTMLVideoElement>('.family-media-video')!
  try{video.pause()}catch{}
  video.removeAttribute('src')
  video.load()
  video.hidden=true
  image.hidden=true
}

function show(next:number){
  if(!items.length)return
  index=Math.max(0,Math.min(next,items.length-1))
  const root=ensure(),item=items[index]
  const image=root.querySelector<HTMLImageElement>('.family-media-image')!
  const video=root.querySelector<HTMLVideoElement>('.family-media-video')!
  resetViewerMedia(root)

  if(item.type==='video'){
    video.src=item.src
    video.setAttribute('aria-label',item.alt||'Video')
    video.hidden=false
    pauseOtherVideos(video)
    void video.play().catch(()=>{})
  }else{
    image.src=item.src
    image.alt=item.alt||'Foto'
    image.hidden=false
  }

  ;(root.querySelector<HTMLElement>('.family-media-prev')!).hidden=index===0
  ;(root.querySelector<HTMLElement>('.family-media-next')!).hidden=index===items.length-1
  ;(root.querySelector<HTMLElement>('.family-media-count')!).textContent=items.length>1?`${index+1} / ${items.length}`:''
}

export function openMediaViewer(next:MediaItem[],start=0,onClose?:()=>void){
  items=next;index=start;closeHandler=onClose||null
  const root=ensure();show(index);root.hidden=false;document.body.style.overflow='hidden'
}

export function closeMediaViewer(){
  if(!overlay||overlay.hidden)return
  resetViewerMedia(overlay)
  overlay.hidden=true;document.body.style.overflow=''
  const cb=closeHandler;closeHandler=null;cb?.()
}

export function isMediaViewerOpen(){return !!overlay&&!overlay.hidden}

// Global media policy: only one video may produce sound/play at a time.
document.addEventListener('play',event=>{
  const video=event.target
  if(video instanceof HTMLVideoElement)pauseOtherVideos(video)
},true)

// Chat videos always open in the shared fullscreen viewer. Capture phase keeps
// the inline Chat click handler from starting a second video underneath it.
document.addEventListener('click',event=>{
  const target=event.target as HTMLElement|null
  const video=target?.closest<HTMLVideoElement>('.chat-video-player')
  if(!video)return
  const src=video.currentSrc||video.src
  if(!src)return
  event.preventDefault()
  event.stopPropagation()
  pauseOtherVideos()
  enterView('media')
  openMediaViewer([{src,alt:video.getAttribute('aria-label')||'Video del chat',type:'video'}])
},true)

window.addEventListener('keydown',e=>{
  if(!isMediaViewerOpen())return
  if(e.key==='Escape'){
    if(currentView()==='media')backView()
    else closeMediaViewer()
  }
  if(e.key==='ArrowLeft')show(index-1)
  if(e.key==='ArrowRight')show(index+1)
})

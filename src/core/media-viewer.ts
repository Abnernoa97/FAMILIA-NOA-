import { backView, currentView } from './navigation'

type MediaItem = { src:string; alt?:string; type?:'image'|'video'; poster?:string }

const STYLE_ID='family-media-viewer-runtime-style'
let overlay:HTMLElement|null=null
let items:MediaItem[]=[]
let index=0
let closeHandler:(()=>void)|null=null
let previousHtmlOverflow=''
let previousBodyOverflow=''
let imageScale=1
let imageOffsetX=0
let imageOffsetY=0

function installRuntimeStyles(){
  if(document.getElementById(STYLE_ID))return
  const style=document.createElement('style')
  style.id=STYLE_ID
  style.textContent=`
    html.family-media-open,body.family-media-open{background:#000!important;overscroll-behavior:none!important}
    body.family-media-open #app{visibility:hidden!important}
    .family-media-viewer{
      position:fixed!important;inset:0!important;top:0!important;right:0!important;bottom:0!important;left:0!important;
      width:100vw!important;height:100dvh!important;min-width:100vw!important;min-height:100dvh!important;
      max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;transform:none!important;
      background:#000!important;overflow:hidden!important;z-index:2147483000!important;touch-action:none!important;isolation:isolate!important;
    }
    .family-media-viewer[hidden]{display:none!important}
    .family-media-stage{
      position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;max-width:none!important;max-height:none!important;
      margin:0!important;padding:0!important;display:block!important;background:#000!important;overflow:hidden!important;
    }
    .family-media-image,.family-media-video{
      position:absolute!important;inset:0!important;margin:auto!important;width:100%!important;height:100%!important;
      max-width:100vw!important;max-height:100dvh!important;object-fit:contain!important;background:#000!important;
    }
    .family-media-image[hidden],.family-media-video[hidden]{display:none!important}
    .family-media-image{touch-action:none!important;transform-origin:center center!important;will-change:transform!important}
    .family-media-open-video{position:fixed!important;z-index:2147483100!important;bottom:max(20px,calc(env(safe-area-inset-bottom) + 12px))!important;left:50%!important;transform:translateX(-50%)!important;max-width:calc(100vw - 30px)!important;padding:10px 16px!important;border:1px solid #ffffff66!important;border-radius:999px!important;background:#151515de!important;color:white!important;font:500 12px system-ui,sans-serif!important;text-decoration:none!important;text-align:center!important;white-space:normal!important}
    .family-media-open-video[hidden]{display:none!important}
    .family-media-video{touch-action:manipulation!important}
    .family-media-close,.family-media-prev,.family-media-next{
      position:fixed!important;z-index:2147483100!important;width:46px!important;height:46px!important;border:0!important;border-radius:50%!important;
      background:rgba(0,0,0,.58)!important;color:#fff!important;display:grid!important;place-items:center!important;padding:0!important;
      line-height:1!important;box-shadow:none!important;
    }
    .family-media-close{top:max(12px,calc(env(safe-area-inset-top) + 8px))!important;left:max(14px,calc(env(safe-area-inset-left) + 10px))!important;font-size:30px!important}
    .family-media-prev{left:max(14px,calc(env(safe-area-inset-left) + 10px))!important;top:50%!important;transform:translateY(-50%)!important;font-size:32px!important}
    .family-media-next{right:max(14px,calc(env(safe-area-inset-right) + 10px))!important;top:50%!important;transform:translateY(-50%)!important;font-size:32px!important}
    .family-media-prev[hidden],.family-media-next[hidden]{display:none!important}
    .family-media-count{position:fixed!important;z-index:2147483100!important;left:50%!important;bottom:max(18px,calc(env(safe-area-inset-bottom) + 12px))!important;transform:translateX(-50%)!important;color:#fff!important;font-size:12px!important}

    /* Composer compatibility: do not depend on :has() for mic/send state. */
    .chat-composer:not(.is-recording) .chat-send{display:none!important}
    .chat-composer:not(.is-recording) #message:not(:placeholder-shown) ~ .chat-send{display:block!important}
    .chat-composer:not(.is-recording) #message:not(:placeholder-shown) + .chat-voice{display:none!important}
  `
  document.head.appendChild(style)
}

installRuntimeStyles()

function pauseOtherMedia(active?:HTMLMediaElement|null){
  document.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media=>{
    if(media!==active&&!media.paused){
      try{media.pause()}catch{}
    }
  })
}

function lockBackground(){
  previousHtmlOverflow=document.documentElement.style.overflow
  previousBodyOverflow=document.body.style.overflow
  document.documentElement.classList.add('family-media-open')
  document.body.classList.add('family-media-open')
  document.documentElement.style.overflow='hidden'
  document.body.style.overflow='hidden'
}

function unlockBackground(){
  document.documentElement.classList.remove('family-media-open')
  document.body.classList.remove('family-media-open')
  document.documentElement.style.overflow=previousHtmlOverflow
  document.body.style.overflow=previousBodyOverflow
}

function ensure(){
  if(overlay?.isConnected)return overlay
  overlay=document.createElement('div')
  overlay.className='family-media-viewer'
  overlay.hidden=true
  overlay.setAttribute('role','dialog')
  overlay.setAttribute('aria-modal','true')
  overlay.innerHTML='<div class="family-media-stage"><button type="button" class="family-media-close" aria-label="Cerrar">×</button><button type="button" class="family-media-prev" aria-label="Anterior">‹</button><img class="family-media-image" alt=""><video class="family-media-video" playsinline controls preload="metadata" hidden></video><button type="button" class="family-media-next" aria-label="Siguiente">›</button><div class="family-media-count"></div><a class="family-media-open-video" href="#" hidden>¿Solo escuchas audio? Abrir fuera de la app ↗</a></div>'
  document.body.appendChild(overlay)

  overlay.querySelector('.family-media-close')?.addEventListener('click',()=>{
    if(currentView()==='media')backView()
    else closeMediaViewer()
  })
  overlay.querySelector('.family-media-prev')?.addEventListener('click',()=>show(index-1))
  overlay.querySelector('.family-media-next')?.addEventListener('click',()=>show(index+1))
  overlay.addEventListener('click',event=>{
    if(event.target!==overlay&&event.target!==overlay.querySelector('.family-media-stage'))return
    if(currentView()==='media')backView()
    else closeMediaViewer()
  })

  const viewerVideo=overlay.querySelector<HTMLVideoElement>('.family-media-video')!
  // Native controls own tap/play/pause/seek interactions. A second click
  // handler here would fight with platform controls on Android WebView.
  viewerVideo.addEventListener('play',()=>pauseOtherMedia(viewerVideo))
  // An MP4 container does not guarantee the video codec can be decoded by
  // Android WebView. Keep native player controls and an external-player route.
  viewerVideo.addEventListener('error',()=>{ 
    const external=overlay?.querySelector<HTMLElement>('.family-media-open-video')
    if(external&&!external.hasAttribute('hidden'))external.textContent='No se pudo reproducir · Abrir fuera de la app ↗'
  })

  const viewerImage=overlay.querySelector<HTMLImageElement>('.family-media-image')!
  let pinching=false
  let startDistance=0
  let startScale=1
  let startX=0
  let startY=0
  let panX=0
  let panY=0
  let lastTapAt=0
  let lastTapX=0
  let lastTapY=0
  const distance=(a:Touch,b:Touch)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)
  const applyImageZoom=()=>{
    const imgW=viewerImage.naturalWidth||1, imgH=viewerImage.naturalHeight||1
    const frameW=viewerImage.clientWidth||window.innerWidth
    const frameH=viewerImage.clientHeight||window.innerHeight
    const fit=Math.min(frameW/imgW,frameH/imgH)
    const maxX=Math.max(0,(imgW*fit*imageScale-frameW)/2)
    const maxY=Math.max(0,(imgH*fit*imageScale-frameH)/2)
    imageOffsetX=Math.max(-maxX,Math.min(maxX,imageOffsetX))
    imageOffsetY=Math.max(-maxY,Math.min(maxY,imageOffsetY))
    viewerImage.style.transform=`translate3d(${imageOffsetX}px,${imageOffsetY}px,0) scale(${imageScale})`
  }
  viewerImage.addEventListener('touchstart',event=>{
    if(viewerImage.hidden)return
    if(event.touches.length>=2){
      pinching=true
      startDistance=Math.max(1,distance(event.touches[0],event.touches[1]))
      startScale=imageScale
      event.preventDefault()
      event.stopPropagation()
    }else if(imageScale>1&&event.touches.length===1){
      startX=event.touches[0].clientX
      startY=event.touches[0].clientY
      panX=imageOffsetX
      panY=imageOffsetY
      event.stopPropagation()
    }
  },{passive:false})
  viewerImage.addEventListener('touchmove',event=>{
    if(viewerImage.hidden)return
    if(pinching&&event.touches.length>=2){
      imageScale=Math.max(1,Math.min(5,startScale*distance(event.touches[0],event.touches[1])/startDistance))
      if(imageScale<=1.01){imageScale=1;imageOffsetX=0;imageOffsetY=0}
      applyImageZoom()
      event.preventDefault()
      event.stopPropagation()
    }else if(imageScale>1&&event.touches.length===1){
      imageOffsetX=panX+event.touches[0].clientX-startX
      imageOffsetY=panY+event.touches[0].clientY-startY
      applyImageZoom()
      event.preventDefault()
      event.stopPropagation()
    }
  },{passive:false})
  viewerImage.addEventListener('touchend',event=>{
    if(viewerImage.hidden)return
    if(pinching){
      if(event.touches.length<2){
        pinching=false
        if(event.touches.length===1){
          startX=event.touches[0].clientX
          startY=event.touches[0].clientY
          panX=imageOffsetX
          panY=imageOffsetY
        }
      }
      event.stopPropagation() // Never turn a pinch into a swipe to another photo.
      return
    }
    if(imageScale>1){
      if(event.touches.length===0&&event.changedTouches.length){
        const tap=event.changedTouches[0]
        const now=performance.now()
        if(now-lastTapAt<320&&Math.hypot(tap.clientX-lastTapX,tap.clientY-lastTapY)<32){
          imageScale=1;imageOffsetX=0;imageOffsetY=0;applyImageZoom()
          lastTapAt=0
        }else{lastTapAt=now;lastTapX=tap.clientX;lastTapY=tap.clientY}
      }
      event.stopPropagation() // While zoomed, horizontal drag pans, not changes photo.
      return
    }
    if(event.changedTouches.length&&event.touches.length===0){
      const tap=event.changedTouches[0],now=performance.now()
      if(now-lastTapAt<320&&Math.hypot(tap.clientX-lastTapX,tap.clientY-lastTapY)<32){
        imageScale=2.5;imageOffsetX=0;imageOffsetY=0;applyImageZoom()
        lastTapAt=0
        event.preventDefault()
        event.stopPropagation()
      }else{lastTapAt=now;lastTapX=tap.clientX;lastTapY=tap.clientY}
    }
  },{passive:false})

  let sx=0,sy=0
  overlay.addEventListener('touchstart',event=>{const touch=event.changedTouches[0];sx=touch.clientX;sy=touch.clientY},{passive:true})
  overlay.addEventListener('touchend',event=>{
    const touch=event.changedTouches[0],dx=touch.clientX-sx,dy=touch.clientY-sy
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2)show(index+(dx<0?1:-1))
  },{passive:true})
  return overlay
}

function resetViewerMedia(root:HTMLElement){
  imageScale=1
  imageOffsetX=0
  imageOffsetY=0
  const image=root.querySelector<HTMLImageElement>('.family-media-image')!
  const video=root.querySelector<HTMLVideoElement>('.family-media-video')!
  try{video.pause()}catch{}
  video.removeAttribute('src')
  video.removeAttribute('poster')
  video.load()
  video.hidden=true
  image.removeAttribute('src')
  image.style.transform=''
  image.hidden=true
  root.querySelector<HTMLElement>('.family-media-open-video')?.setAttribute('hidden','')
}

function show(next:number){
  if(!items.length)return
  index=Math.max(0,Math.min(next,items.length-1))
  const root=ensure(),item=items[index]
  const image=root.querySelector<HTMLImageElement>('.family-media-image')!
  const video=root.querySelector<HTMLVideoElement>('.family-media-video')!
  resetViewerMedia(root)

  if(item.type==='video'){
    const external=root.querySelector<HTMLAnchorElement>('.family-media-open-video')!
    // Only permit original signed HTTPS links. Blob URLs cannot be opened
    // outside the WebView and signed URLs are deliberately short-lived.
    if(/^https:\/\//i.test(item.src)){
      external.href=item.src
      external.textContent='¿Solo escuchas audio? Abrir fuera de la app ↗'
      external.removeAttribute('hidden')
    }
    video.src=item.src
    if(item.poster)video.poster=item.poster
    video.setAttribute('aria-label',item.alt||'Video')
    video.hidden=false
    pauseOtherMedia(video)
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
  items=next
  index=start
  closeHandler=onClose||null
  const root=ensure()
  lockBackground()
  show(index)
  root.hidden=false
}

export function closeMediaViewer(){
  if(!overlay||overlay.hidden)return
  resetViewerMedia(overlay)
  overlay.hidden=true
  unlockBackground()
  const cb=closeHandler
  closeHandler=null
  cb?.()
}

export function isMediaViewerOpen(){return !!overlay&&!overlay.hidden}

document.addEventListener('play',event=>{
  const media=event.target
  if(media instanceof HTMLMediaElement)pauseOtherMedia(media)
},true)

window.addEventListener('keydown',event=>{
  if(!isMediaViewerOpen())return
  if(event.key==='Escape'){
    if(currentView()==='media')backView()
    else closeMediaViewer()
  }
  if(event.key==='ArrowLeft')show(index-1)
  if(event.key==='ArrowRight')show(index+1)
})

import { backView, currentView } from './navigation'

type MediaItem = { src:string; alt?:string; type?:'image'|'video'; poster?:string }

const STYLE_ID='family-media-viewer-runtime-style'
let overlay:HTMLElement|null=null
let items:MediaItem[]=[]
let index=0
let closeHandler:(()=>void)|null=null
let previousHtmlOverflow=''
let previousBodyOverflow=''

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
  overlay.innerHTML='<div class="family-media-stage"><button type="button" class="family-media-close" aria-label="Cerrar">×</button><button type="button" class="family-media-prev" aria-label="Anterior">‹</button><img class="family-media-image" alt=""><video class="family-media-video" playsinline preload="metadata" hidden></video><button type="button" class="family-media-next" aria-label="Siguiente">›</button><div class="family-media-count"></div></div>'
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
  viewerVideo.addEventListener('click',event=>{
    event.stopPropagation()
    if(viewerVideo.ended)viewerVideo.currentTime=0
    if(viewerVideo.paused){
      pauseOtherMedia(viewerVideo)
      void viewerVideo.play().catch(()=>{})
    }else viewerVideo.pause()
  })
  viewerVideo.addEventListener('play',()=>pauseOtherMedia(viewerVideo))

  let sx=0,sy=0
  overlay.addEventListener('touchstart',event=>{const touch=event.changedTouches[0];sx=touch.clientX;sy=touch.clientY},{passive:true})
  overlay.addEventListener('touchend',event=>{
    const touch=event.changedTouches[0],dx=touch.clientX-sx,dy=touch.clientY-sy
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2)show(index+(dx<0?1:-1))
  },{passive:true})
  return overlay
}

function resetViewerMedia(root:HTMLElement){
  const image=root.querySelector<HTMLImageElement>('.family-media-image')!
  const video=root.querySelector<HTMLVideoElement>('.family-media-video')!
  try{video.pause()}catch{}
  video.removeAttribute('src')
  video.removeAttribute('poster')
  video.load()
  video.hidden=true
  image.removeAttribute('src')
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

type MediaItem = { src:string; alt?:string }

let overlay:HTMLElement|null=null
let items:MediaItem[]=[]
let index=0
let closeHandler:(()=>void)|null=null

function ensure(){
  if(overlay?.isConnected)return overlay
  overlay=document.createElement('div')
  overlay.className='family-media-viewer'
  overlay.hidden=true
  overlay.innerHTML='<div class="family-media-stage"><button type="button" class="family-media-close" aria-label="Cerrar">×</button><button type="button" class="family-media-prev" aria-label="Anterior">‹</button><img class="family-media-image" alt=""><button type="button" class="family-media-next" aria-label="Siguiente">›</button><div class="family-media-count"></div></div>'
  document.body.appendChild(overlay)
  overlay.querySelector('.family-media-close')?.addEventListener('click',()=>closeMediaViewer())
  overlay.querySelector('.family-media-prev')?.addEventListener('click',()=>show(index-1))
  overlay.querySelector('.family-media-next')?.addEventListener('click',()=>show(index+1))
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeMediaViewer()})
  let sx=0,sy=0
  overlay.addEventListener('touchstart',e=>{const t=e.changedTouches[0];sx=t.clientX;sy=t.clientY},{passive:true})
  overlay.addEventListener('touchend',e=>{const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.2)show(index+(dx<0?1:-1))},{passive:true})
  return overlay
}
function show(next:number){
  if(!items.length)return
  index=Math.max(0,Math.min(next,items.length-1))
  const root=ensure(),item=items[index]
  const image=root.querySelector<HTMLImageElement>('.family-media-image')!
  image.src=item.src;image.alt=item.alt||'Foto'
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
  overlay.hidden=true;document.body.style.overflow=''
  const cb=closeHandler;closeHandler=null;cb?.()
}
export function isMediaViewerOpen(){return !!overlay&&!overlay.hidden}
window.addEventListener('keydown',e=>{if(!isMediaViewerOpen())return;if(e.key==='Escape')history.back();if(e.key==='ArrowLeft')show(index-1);if(e.key==='ArrowRight')show(index+1)})

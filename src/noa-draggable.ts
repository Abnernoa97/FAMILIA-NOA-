const STORAGE_KEY='familia-noa-noa-position-v1'
const EDGE=10
const DRAG_THRESHOLD=6

let enhanced:HTMLButtonElement|null=null
let observer:MutationObserver|null=null
let dragging=false
let moved=false
let suppressClick=false
let pointerId:number|null=null
let startPointer={x:0,y:0}
let startButton={x:0,y:0}

function clamp(value:number,min:number,max:number){return Math.min(Math.max(value,min),max)}

function bounds(button:HTMLElement){
  const rect=button.getBoundingClientRect()
  return {
    maxX:Math.max(EDGE,window.innerWidth-rect.width-EDGE),
    maxY:Math.max(EDGE,window.innerHeight-rect.height-EDGE),
  }
}

function applyPosition(button:HTMLButtonElement,x:number,y:number,save=false){
  const limit=bounds(button)
  const left=clamp(x,EDGE,limit.maxX)
  const top=clamp(y,EDGE,limit.maxY)
  button.style.setProperty('left',`${left}px`,'important')
  button.style.setProperty('top',`${top}px`,'important')
  button.style.setProperty('right','auto','important')
  button.style.setProperty('bottom','auto','important')
  if(save){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({x:left,y:top}))}catch{}
  }
}

function restore(button:HTMLButtonElement){
  try{
    const raw=localStorage.getItem(STORAGE_KEY)
    if(!raw)return
    const value=JSON.parse(raw)
    if(Number.isFinite(value?.x)&&Number.isFinite(value?.y))applyPosition(button,value.x,value.y,false)
  }catch{}
}

function onPointerDown(event:PointerEvent){
  const button=enhanced
  if(!button||event.button!==0)return
  dragging=true;moved=false;suppressClick=false;pointerId=event.pointerId
  startPointer={x:event.clientX,y:event.clientY}
  const rect=button.getBoundingClientRect();startButton={x:rect.left,y:rect.top}
  button.classList.add('noa-dragging')
  try{button.setPointerCapture(event.pointerId)}catch{}
}

function onPointerMove(event:PointerEvent){
  const button=enhanced
  if(!button||!dragging||pointerId!==event.pointerId)return
  const dx=event.clientX-startPointer.x
  const dy=event.clientY-startPointer.y
  if(!moved&&Math.hypot(dx,dy)<DRAG_THRESHOLD)return
  moved=true
  event.preventDefault()
  applyPosition(button,startButton.x+dx,startButton.y+dy,false)
}

function finishDrag(event:PointerEvent){
  const button=enhanced
  if(!button||!dragging||pointerId!==event.pointerId)return
  dragging=false;pointerId=null
  button.classList.remove('noa-dragging')
  try{button.releasePointerCapture(event.pointerId)}catch{}
  if(moved){
    const rect=button.getBoundingClientRect()
    applyPosition(button,rect.left,rect.top,true)
    suppressClick=true
    window.setTimeout(()=>{suppressClick=false},180)
  }
}

function onClickCapture(event:MouseEvent){
  if(!suppressClick)return
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation()
  suppressClick=false
}

function enhance(button:HTMLButtonElement){
  if(enhanced===button)return
  if(enhanced){
    enhanced.removeEventListener('pointerdown',onPointerDown)
    enhanced.removeEventListener('pointermove',onPointerMove)
    enhanced.removeEventListener('pointerup',finishDrag)
    enhanced.removeEventListener('pointercancel',finishDrag)
    enhanced.removeEventListener('click',onClickCapture,true)
  }
  enhanced=button
  button.dataset.noaDraggable='1'
  button.style.setProperty('touch-action','none','important')
  button.style.setProperty('user-select','none','important')
  button.style.setProperty('-webkit-user-select','none','important')
  button.style.setProperty('cursor','grab','important')
  button.addEventListener('pointerdown',onPointerDown)
  button.addEventListener('pointermove',onPointerMove)
  button.addEventListener('pointerup',finishDrag)
  button.addEventListener('pointercancel',finishDrag)
  button.addEventListener('click',onClickCapture,true)
  restore(button)
}

function scan(){
  const button=document.querySelector<HTMLButtonElement>('.noa-fab')
  if(button)enhance(button)
}

function keepInside(){
  const button=enhanced
  if(!button||!button.isConnected)return
  const rect=button.getBoundingClientRect()
  if(button.style.left)applyPosition(button,rect.left,rect.top,true)
}

const style=document.createElement('style')
style.id='noa-draggable-css'
style.textContent=`.noa-fab.noa-dragging{cursor:grabbing!important;transition:none!important;animation:none!important;transform:scale(1.04)!important;box-shadow:0 14px 34px rgba(0,0,0,.26)!important}.noa-fab[data-noa-draggable="1"]{-webkit-touch-callout:none!important}`
document.head.appendChild(style)

observer=new MutationObserver(scan)
observer.observe(document.body,{childList:true,subtree:true})
window.addEventListener('resize',keepInside)
window.addEventListener('orientationchange',()=>setTimeout(keepInside,120))
window.addEventListener('beforeunload',()=>{observer?.disconnect();window.removeEventListener('resize',keepInside)},{once:true})
scan()

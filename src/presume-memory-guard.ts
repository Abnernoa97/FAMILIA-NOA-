let captureSuspended=false
let restoreTimer:number|null=null
const suspendedMedia=new Map<HTMLMediaElement,string>()

function presumeRoot(){return document.querySelector<HTMLElement>('.presume-screen')}

function clearRestoreTimer(){
  if(restoreTimer!==null){
    clearTimeout(restoreTimer)
    restoreTimer=null
  }
}

function unloadMedia(){
  if(captureSuspended)return
  const root=presumeRoot()
  if(!root)return
  captureSuspended=true
  clearRestoreTimer()

  root.querySelectorAll<HTMLMediaElement>('video,audio').forEach(media=>{
    try{media.pause()}catch{}
    const src=media.currentSrc||media.getAttribute('src')||''
    if(!src)return
    suspendedMedia.set(media,src)
    media.removeAttribute('src')
    try{media.load()}catch{}
  })

  root.dataset.captureSuspended='1'
  root.style.visibility='hidden'
}

function restoreMedia(){
  if(!captureSuspended)return
  const root=presumeRoot()
  if(!root){
    suspendedMedia.clear()
    captureSuspended=false
    clearRestoreTimer()
    return
  }

  if(document.hidden)return
  if(document.querySelector('.pres-modal,.pres-live-camera')){
    clearRestoreTimer()
    restoreTimer=window.setTimeout(restoreMedia,250)
    return
  }

  suspendedMedia.forEach((src,media)=>{
    if(!media.isConnected)return
    media.setAttribute('src',src)
    try{media.load()}catch{}
  })
  suspendedMedia.clear()
  root.style.visibility=''
  delete root.dataset.captureSuspended
  captureSuspended=false
  clearRestoreTimer()
}

function scheduleRestore(){
  clearRestoreTimer()
  restoreTimer=window.setTimeout(restoreMedia,120)
}

document.addEventListener('click',event=>{
  const target=event.target as Element|null
  if(target?.closest('[data-camera],[data-video]'))unloadMedia()
},true)

document.addEventListener('change',event=>{
  const target=event.target as Element|null
  if(target?.matches('[data-camera-input],[data-video-input]'))scheduleRestore()
},true)

document.addEventListener('presume:capture-start',unloadMedia)
document.addEventListener('presume:capture-end',scheduleRestore)
window.addEventListener('focus',scheduleRestore)
document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRestore()})

window.addEventListener('beforeunload',()=>{
  clearRestoreTimer()
  suspendedMedia.clear()
},{once:true})

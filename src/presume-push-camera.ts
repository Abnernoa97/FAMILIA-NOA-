type Slot='morning'|'afternoon'

let active=false
let liveRoot:HTMLElement|null=null
let liveStream:MediaStream|null=null

function stopLiveCamera(){
  liveStream?.getTracks().forEach(track=>{try{track.stop()}catch{}})
  liveStream=null
  liveRoot?.remove()
  liveRoot=null
  active=false
  document.dispatchEvent(new CustomEvent('presume:capture-end'))
}

function cameraInput(){
  return document.querySelector<HTMLInputElement>('.presume-screen [data-camera-input]')
}

function handoff(file:File){
  const input=cameraInput()
  if(!input)throw new Error('PRESUME_CAMERA_INPUT_MISSING')
  const transfer=new DataTransfer()
  transfer.items.add(file)
  input.files=transfer.files
  input.dispatchEvent(new Event('change',{bubbles:true}))
}

function fallback(root:HTMLElement,message='Toca para abrir la cámara del teléfono.'){
  const stage=root.querySelector<HTMLElement>('[data-live-stage]')
  if(stage)stage.innerHTML=`<div class="pres-live-fallback"><b>No se pudo abrir la cámara directamente</b><span>${message}</span><button type="button" data-native-camera>Abrir cámara</button></div>`
  root.querySelector<HTMLButtonElement>('[data-native-camera]')?.addEventListener('click',()=>{
    const input=cameraInput()
    stopLiveCamera()
    input?.click()
  },{once:true})
}

async function openLiveCamera(slot:Slot){
  if(active)return
  if(navigator.userActivation?.isActive)return
  active=true
  const root=document.createElement('div')
  root.className='pres-live-camera'
  root.innerHTML=`<style>
  .pres-live-camera{position:fixed;inset:0;z-index:1700;background:#050505;color:#fff;display:grid;grid-template-rows:auto 1fr auto;min-height:100dvh}
  .pres-live-top{display:flex;align-items:center;justify-content:space-between;padding:max(14px,env(safe-area-inset-top)) 15px 10px;font:700 12px system-ui}.pres-live-close{border:0;width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:25px}.pres-live-stage{min-height:0;display:grid;place-items:center;overflow:hidden;position:relative}.pres-live-stage video{width:100%;height:100%;object-fit:cover;background:#000}.pres-live-bottom{display:flex;justify-content:center;align-items:center;padding:18px 18px calc(22px + env(safe-area-inset-bottom))}.pres-live-shutter{width:74px;height:74px;border-radius:50%;border:6px solid #fff;background:rgba(255,255,255,.28);box-shadow:0 0 0 2px rgba(0,0,0,.3)}.pres-live-fallback{padding:30px;text-align:center;display:grid;gap:10px;max-width:320px}.pres-live-fallback b{font:600 21px Georgia,serif}.pres-live-fallback span{font:12px/1.45 system-ui;color:#c9c9c9}.pres-live-fallback button{margin-top:8px;border:0;border-radius:15px;background:#fff;color:#111;min-height:48px;font:800 13px system-ui}
  </style><div class="pres-live-top"><span>PRESUME · ${slot==='afternoon'?'TARDE':'MAÑANA'}</span><button class="pres-live-close" type="button" aria-label="Cerrar">×</button></div><div class="pres-live-stage" data-live-stage><div class="pres-live-fallback"><span>Abriendo cámara…</span></div></div><div class="pres-live-bottom"><button class="pres-live-shutter" type="button" data-live-shutter aria-label="Tomar foto" hidden></button></div>`
  liveRoot=root
  document.body.appendChild(root)
  root.querySelector('.pres-live-close')?.addEventListener('click',stopLiveCamera,{once:true})

  if(!navigator.mediaDevices?.getUserMedia){fallback(root);return}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false})
    if(!root.isConnected){stream.getTracks().forEach(track=>track.stop());return}
    liveStream=stream
    const stage=root.querySelector<HTMLElement>('[data-live-stage]')!
    const video=document.createElement('video')
    video.autoplay=true
    video.playsInline=true
    video.muted=true
    video.srcObject=stream
    stage.replaceChildren(video)
    await video.play().catch(()=>{})
    const shutter=root.querySelector<HTMLButtonElement>('[data-live-shutter]')!
    shutter.hidden=false
    shutter.addEventListener('click',async()=>{
      if(shutter.disabled)return
      shutter.disabled=true
      try{
        const width=video.videoWidth||1280,height=video.videoHeight||720
        const max=1600,scale=Math.min(1,max/Math.max(width,height))
        const canvas=document.createElement('canvas')
        canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale))
        const ctx=canvas.getContext('2d')
        if(!ctx)throw new Error('CAMERA_CANVAS_FAILED')
        ctx.drawImage(video,0,0,canvas.width,canvas.height)
        const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.9))
        if(!blob)throw new Error('CAMERA_CAPTURE_FAILED')
        const file=new File([blob],`presume-${slot}-${Date.now()}.jpg`,{type:'image/jpeg',lastModified:Date.now()})
        stopLiveCamera()
        handoff(file)
      }catch(error){
        console.error('PRESUME push camera capture failed',error)
        shutter.disabled=false
      }
    })
  }catch(error){
    console.error('PRESUME direct push camera unavailable',error)
    fallback(root,'Puedes continuar con la cámara normal del teléfono.')
  }
}

document.addEventListener('presume:open-challenge-camera',event=>{
  const detail=(event as CustomEvent<{slot?:Slot}>).detail
  const slot:Slot=detail?.slot==='afternoon'?'afternoon':'morning'
  void openLiveCamera(slot)
})

window.addEventListener('beforeunload',()=>{
  liveStream?.getTracks().forEach(track=>{try{track.stop()}catch{}})
},{once:true})

export type OptimizedPhoto={blob:Blob;type:string;name:string;ext:string;width:number;height:number}
export type PreparedVideo={blob:Blob;type:string;name:string;ext:string}
export type PreparedAudio={blob:Blob;type:string;name:string;ext:string}

// Videos larger than the safe upload size are transcoded locally before they
// ever reach Supabase. This lets the picker accept normal phone videos while
// keeping the stored Chat copy small and inside the server-side media guard.
export const CHAT_VIDEO_MAX_BYTES=120*1024*1024
export const CHAT_VIDEO_DIRECT_MAX_BYTES=11*1024*1024
export const CHAT_VIDEO_TARGET_BYTES=9.5*1024*1024
export const CHAT_AUDIO_MAX_BYTES=8*1024*1024

const VIDEO_TYPES:Record<string,{ext:string;type:string}>={
  'video/mp4':{ext:'mp4',type:'video/mp4'},
  'video/webm':{ext:'webm',type:'video/webm'},
  'video/quicktime':{ext:'mov',type:'video/quicktime'},
  'video/x-m4v':{ext:'m4v',type:'video/x-m4v'}
}

const AUDIO_TYPES:Record<string,{ext:string;type:string}>={
  'audio/mpeg':{ext:'mp3',type:'audio/mpeg'},
  'audio/mp4':{ext:'m4a',type:'audio/mp4'},
  'audio/x-m4a':{ext:'m4a',type:'audio/mp4'},
  'audio/aac':{ext:'aac',type:'audio/aac'},
  'audio/wav':{ext:'wav',type:'audio/wav'},
  'audio/x-wav':{ext:'wav',type:'audio/wav'},
  'audio/webm':{ext:'webm',type:'audio/webm'},
  'audio/ogg':{ext:'ogg',type:'audio/ogg'}
}

async function decode(file:File):Promise<{source:CanvasImageSource;width:number;height:number;dispose:()=>void}>{
  if('createImageBitmap'in window){
    const bitmap=await createImageBitmap(file)
    return{source:bitmap,width:bitmap.width,height:bitmap.height,dispose:()=>bitmap.close()}
  }
  const url=URL.createObjectURL(file)
  const image=new Image()
  image.decoding='async'
  image.src=url
  await image.decode()
  return{source:image,width:image.naturalWidth,height:image.naturalHeight,dispose:()=>URL.revokeObjectURL(url)}
}

export async function optimizePhoto(file:File,maxSide=1200,quality=.78):Promise<OptimizedPhoto>{
  if(file.type==='image/gif')throw new Error('GIF_NOT_SUPPORTED')

  if((file.type==='image/jpeg'||file.type==='image/webp')&&file.size<=220*1024){
    const ext=file.type==='image/webp'?'webp':'jpg'
    return{blob:file,type:file.type,name:file.name||`foto.${ext}`,ext,width:0,height:0}
  }

  try{
    const decoded=await decode(file)
    const scale=Math.min(1,maxSide/Math.max(decoded.width,decoded.height))
    const width=Math.max(1,Math.round(decoded.width*scale))
    const height=Math.max(1,Math.round(decoded.height*scale))
    const canvas=document.createElement('canvas')
    canvas.width=width
    canvas.height=height
    const ctx=canvas.getContext('2d',{alpha:false})
    if(!ctx){decoded.dispose();throw new Error('Canvas unavailable')}
    ctx.drawImage(decoded.source,0,0,width,height)
    decoded.dispose()
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Compression failed')),'image/jpeg',quality))
    const base=file.name.replace(/\.[^.]+$/,'')||'foto'
    return{blob,type:'image/jpeg',name:`${base}.jpg`,ext:'jpg',width,height}
  }catch(error){
    const allowed:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic'}
    const ext=allowed[file.type]
    if(!ext)throw error
    return{blob:file,type:file.type,name:file.name||`foto.${ext}`,ext,width:0,height:0}
  }
}

function videoDescriptor(file:File){
  const direct=VIDEO_TYPES[file.type.toLowerCase()]
  if(direct)return direct
  const ext=(file.name.split('.').pop()||'').toLowerCase()
  return Object.values(VIDEO_TYPES).find(item=>item.ext===ext)||null
}

function recorderMimeType(){
  if(typeof MediaRecorder==='undefined')return''
  const preferred=[
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ]
  return preferred.find(type=>MediaRecorder.isTypeSupported?.(type))||''
}

function waitForVideoMetadata(video:HTMLVideoElement){
  if(video.readyState>=1)return Promise.resolve()
  return new Promise<void>((resolve,reject)=>{
    const loaded=()=>{cleanup();resolve()}
    const failed=()=>{cleanup();reject(new Error('VIDEO_METADATA_FAILED'))}
    const cleanup=()=>{
      video.removeEventListener('loadedmetadata',loaded)
      video.removeEventListener('error',failed)
    }
    video.addEventListener('loadedmetadata',loaded,{once:true})
    video.addEventListener('error',failed,{once:true})
  })
}

async function optimizeVideo(file:File):Promise<PreparedVideo>{
  if(typeof MediaRecorder==='undefined')throw new Error('VIDEO_OPTIMIZATION_UNSUPPORTED')

  const url=URL.createObjectURL(file)
  const video=document.createElement('video')
  video.preload='auto'
  video.playsInline=true
  video.muted=true
  video.src=url
  video.style.position='fixed'
  video.style.width='1px'
  video.style.height='1px'
  video.style.opacity='0'
  video.style.pointerEvents='none'
  video.style.left='-10px'
  video.style.bottom='0'
  document.body.appendChild(video)

  let stream:MediaStream|null=null
  let recorder:MediaRecorder|null=null

  try{
    await waitForVideoMetadata(video)
    const duration=video.duration
    if(!Number.isFinite(duration)||duration<=0)throw new Error('VIDEO_METADATA_FAILED')

    const capture=(video as any).captureStream||(video as any).mozCaptureStream
    if(typeof capture!=='function')throw new Error('VIDEO_OPTIMIZATION_UNSUPPORTED')

    const mimeType=recorderMimeType()
    if(!mimeType)throw new Error('VIDEO_OPTIMIZATION_UNSUPPORTED')

    stream=capture.call(video) as MediaStream
    const totalBitsPerSecond=Math.floor(Math.min(
      2_200_000,
      Math.max(480_000,(CHAT_VIDEO_TARGET_BYTES*8/duration)*0.9)
    ))
    const audioBitsPerSecond=64_000
    const videoBitsPerSecond=Math.max(360_000,totalBitsPerSecond-audioBitsPerSecond)
    const chunks:Blob[]=[]

    recorder=new MediaRecorder(stream,{
      mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond
    })

    const recording=new Promise<Blob>((resolve,reject)=>{
      recorder!.addEventListener('dataavailable',event=>{
        if(event.data.size>0)chunks.push(event.data)
      })
      recorder!.addEventListener('error',event=>{
        reject((event as any).error||new Error('VIDEO_OPTIMIZATION_FAILED'))
      },{once:true})
      recorder!.addEventListener('stop',()=>{
        const type=(recorder!.mimeType||mimeType).split(';')[0]
        const blob=new Blob(chunks,{type})
        if(!blob.size)reject(new Error('VIDEO_OPTIMIZATION_FAILED'))
        else resolve(blob)
      },{once:true})
    })

    const ended=new Promise<void>((resolve,reject)=>{
      video.addEventListener('ended',()=>resolve(),{once:true})
      video.addEventListener('error',()=>reject(new Error('VIDEO_OPTIMIZATION_FAILED')),{once:true})
    })

    recorder.start(1000)
    await video.play()
    await ended
    if(recorder.state!=='inactive')recorder.stop()
    const blob=await recording

    // The database/storage guard is intentionally stricter than the bucket's
    // absolute limit. If the first pass cannot get below it, fail safely rather
    // than storing an unexpectedly heavy Chat asset.
    if(blob.size>CHAT_VIDEO_DIRECT_MAX_BYTES)throw new Error('VIDEO_OPTIMIZATION_TOO_LARGE')

    const type=blob.type||'video/webm'
    const ext=type.includes('mp4')?'mp4':'webm'
    const base=file.name.replace(/\.[^.]+$/,'')||'video'
    return{blob,type,name:`${base}-chat.${ext}`,ext}
  }catch(error){
    if(recorder&&recorder.state!=='inactive'){
      try{recorder.stop()}catch{}
    }
    throw error
  }finally{
    try{video.pause()}catch{}
    stream?.getTracks().forEach(track=>track.stop())
    video.removeAttribute('src')
    video.load()
    video.remove()
    URL.revokeObjectURL(url)
  }
}

export async function prepareVideo(file:File):Promise<PreparedVideo>{
  const descriptor=videoDescriptor(file)
  if(!descriptor)throw new Error('VIDEO_NOT_SUPPORTED')
  if(file.size>CHAT_VIDEO_MAX_BYTES)throw new Error('VIDEO_SOURCE_TOO_LARGE')

  if(file.size<=CHAT_VIDEO_DIRECT_MAX_BYTES){
    return{blob:file,type:descriptor.type,name:file.name||`video.${descriptor.ext}`,ext:descriptor.ext}
  }

  return optimizeVideo(file)
}

export function isSupportedVideo(file:File){
  return !!videoDescriptor(file)
}

export function prepareAudio(file:File):PreparedAudio{
  const direct=AUDIO_TYPES[file.type.toLowerCase()]
  if(direct)return{blob:file,type:direct.type,name:file.name||`audio.${direct.ext}`,ext:direct.ext}

  const ext=(file.name.split('.').pop()||'').toLowerCase()
  const fallback=Object.values(AUDIO_TYPES).find(item=>item.ext===ext)
  if(!fallback)throw new Error('AUDIO_NOT_SUPPORTED')
  return{blob:file,type:fallback.type,name:file.name||`audio.${fallback.ext}`,ext:fallback.ext}
}

export function isSupportedAudio(file:File){
  try{prepareAudio(file);return true}catch{return false}
}

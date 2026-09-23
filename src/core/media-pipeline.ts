export type OptimizedPhoto={blob:Blob;type:string;name:string;ext:string;width:number;height:number}
export type PreparedVideo={blob:Blob;type:string;name:string;ext:string}
export type PreparedAudio={blob:Blob;type:string;name:string;ext:string}

export const CHAT_IMAGE_MAX_BYTES=15*1024*1024
export const CHAT_VIDEO_MAX_BYTES=50*1024*1024
export const CHAT_AUDIO_MAX_BYTES=8*1024*1024
export const mediaLimitMb=(bytes:number)=>Math.round(bytes/(1024*1024))

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

export async function optimizeAvatar(file:File,maxSide=256,quality=.78):Promise<OptimizedPhoto>{
  if(file.type==='image/gif')throw new Error('GIF_NOT_SUPPORTED')
  try{
    const decoded=await decode(file)
    const crop=Math.min(decoded.width,decoded.height)
    const side=Math.max(1,Math.min(maxSide,crop))
    const sx=Math.max(0,(decoded.width-crop)/2)
    const sy=Math.max(0,(decoded.height-crop)/2)
    const canvas=document.createElement('canvas')
    canvas.width=side
    canvas.height=side
    const ctx=canvas.getContext('2d',{alpha:false})
    if(!ctx){decoded.dispose();throw new Error('Canvas unavailable')}
    ctx.fillStyle='#fff'
    ctx.fillRect(0,0,side,side)
    ctx.drawImage(decoded.source,sx,sy,crop,crop,0,0,side,side)
    decoded.dispose()
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Compression failed')),'image/jpeg',quality))
    const base=file.name.replace(/\.[^.]+$/,'')||'avatar'
    return{blob,type:'image/jpeg',name:`${base}.jpg`,ext:'jpg',width:side,height:side}
  }catch(error){
    if((file.type==='image/jpeg'||file.type==='image/webp')&&file.size<=350*1024){
      const ext=file.type==='image/webp'?'webp':'jpg'
      return{blob:file,type:file.type,name:file.name||`avatar.${ext}`,ext,width:0,height:0}
    }
    throw error
  }
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

export function prepareVideo(file:File):PreparedVideo{
  const descriptor=videoDescriptor(file)
  if(!descriptor)throw new Error('VIDEO_NOT_SUPPORTED')
  if(file.size>CHAT_VIDEO_MAX_BYTES)throw new Error('VIDEO_SOURCE_TOO_LARGE')
  return{blob:file,type:descriptor.type,name:file.name||`video.${descriptor.ext}`,ext:descriptor.ext}
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

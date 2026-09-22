export type OptimizedPhoto={blob:Blob;type:string;name:string;ext:string;width:number;height:number}
export type PreparedVideo={blob:Blob;type:string;name:string;ext:string}

export const CHAT_VIDEO_MAX_BYTES=12*1024*1024

const VIDEO_TYPES:Record<string,{ext:string;type:string}>={
  'video/mp4':{ext:'mp4',type:'video/mp4'},
  'video/webm':{ext:'webm',type:'video/webm'},
  'video/quicktime':{ext:'mov',type:'video/quicktime'},
  'video/x-m4v':{ext:'m4v',type:'video/x-m4v'}
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

export function prepareVideo(file:File):PreparedVideo{
  const direct=VIDEO_TYPES[file.type.toLowerCase()]
  if(direct)return{blob:file,type:direct.type,name:file.name||`video.${direct.ext}`,ext:direct.ext}

  const ext=(file.name.split('.').pop()||'').toLowerCase()
  const fallback=Object.values(VIDEO_TYPES).find(item=>item.ext===ext)
  if(!fallback)throw new Error('VIDEO_NOT_SUPPORTED')
  return{blob:file,type:fallback.type,name:file.name||`video.${fallback.ext}`,ext:fallback.ext}
}

export function isSupportedVideo(file:File){
  try{prepareVideo(file);return true}catch{return false}
}

export type OptimizedPhoto={blob:Blob;type:string;name:string;ext:string;width:number;height:number}
async function decode(file:File):Promise<{source:CanvasImageSource;width:number;height:number;dispose:()=>void}>{
 if('createImageBitmap'in window){const b=await createImageBitmap(file);return{source:b,width:b.width,height:b.height,dispose:()=>b.close()}}
 const url=URL.createObjectURL(file),image=new Image();image.decoding='async';image.src=url;await image.decode();return{source:image,width:image.naturalWidth,height:image.naturalHeight,dispose:()=>URL.revokeObjectURL(url)}
}
export async function optimizePhoto(file:File,maxSide=1200,quality=.8):Promise<OptimizedPhoto>{
 if(file.type==='image/gif')throw new Error('GIF_NOT_SUPPORTED')
 try{
  const d=await decode(file),scale=Math.min(1,maxSide/Math.max(d.width,d.height)),width=Math.max(1,Math.round(d.width*scale)),height=Math.max(1,Math.round(d.height*scale))
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx){d.dispose();throw new Error('Canvas unavailable')}
  ctx.drawImage(d.source,0,0,width,height);d.dispose()
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(new Error('Compression failed')),'image/jpeg',quality))
  const base=file.name.replace(/\.[^.]+$/,'')||'foto';return{blob,type:'image/jpeg',name:`${base}.jpg`,ext:'jpg',width,height}
 }catch(error){
  const allowed:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic'},ext=allowed[file.type];if(!ext)throw error
  return{blob:file,type:file.type,name:file.name||`foto.${ext}`,ext,width:0,height:0}
 }
}

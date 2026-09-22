import * as tus from 'tus-js-client'
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../supabase'

const CHAT_BUCKET='family-photos'
const RESUMABLE_THRESHOLD=6*1024*1024
const CHUNK_SIZE=6*1024*1024
const PROJECT_ID=new URL(SUPABASE_URL).hostname.split('.')[0]
const STORAGE_HOST=`${PROJECT_ID}.storage.supabase.co`
const TUS_ENDPOINT=`https://${STORAGE_HOST}/storage/v1/upload/resumable`

type UploadOptions={
  contentType?:string
  cacheControl?:string
  onProgress?:(uploaded:number,total:number)=>void
}

type UploadResult={data:{path:string};error:null}
type ActiveUpload={promise:Promise<UploadResult>;listeners:Set<(uploaded:number,total:number)=>void>}
const activeUploads=new Map<string,ActiveUpload>()

function emit(entry:ActiveUpload,uploaded:number,total:number){
  entry.listeners.forEach(listener=>{
    try{listener(uploaded,total)}catch{}
  })
}

function alreadyExists(error:any){
  const message=String(error?.message||error||'').toLowerCase()
  const status=Number(error?.statusCode||error?.status||0)
  return status===409||message.includes('already exists')||message.includes('duplicate')||message.includes('resource already exists')
}

async function signedUpload(path:string){
  const api=supabase.storage.from(CHAT_BUCKET)
  const {data,error}=await api.createSignedUploadUrl(path,{upsert:false})
  if(error||!data?.token)throw error||new Error('CHAT_SIGNED_UPLOAD_UNAVAILABLE')
  return{api,data}
}

function xhrPut(url:string,path:string,file:Blob,options:UploadOptions,entry:ActiveUpload){
  return new Promise<UploadResult>((resolve,reject)=>{
    const xhr=new XMLHttpRequest()
    const body=new FormData()
    body.append('cacheControl',String(options.cacheControl||'31536000'))
    body.append('',file)
    xhr.open('PUT',url,true)
    xhr.setRequestHeader('apikey',SUPABASE_PUBLISHABLE_KEY)
    xhr.setRequestHeader('x-upsert','false')
    xhr.upload.onprogress=event=>{if(event.lengthComputable)emit(entry,event.loaded,event.total)}
    xhr.onerror=()=>reject(new Error('CHAT_UPLOAD_NETWORK_ERROR'))
    xhr.onabort=()=>reject(new Error('CHAT_UPLOAD_ABORTED'))
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300){emit(entry,file.size,file.size);resolve({data:{path},error:null});return}
      if(xhr.status===409){emit(entry,file.size,file.size);resolve({data:{path},error:null});return}
      reject(new Error(`CHAT_SIGNED_UPLOAD_FAILED_${xhr.status}`))
    }
    xhr.send(body)
  })
}

async function signedProgressUpload(path:string,file:Blob,options:UploadOptions,entry:ActiveUpload){
  const {data}=await signedUpload(path)
  if(!data.signedUrl)throw new Error('CHAT_SIGNED_UPLOAD_URL_UNAVAILABLE')
  let directUrl=data.signedUrl
  try{const url=new URL(data.signedUrl);url.hostname=STORAGE_HOST;directUrl=url.toString()}catch{}
  try{return await xhrPut(directUrl,path,file,options,entry)}
  catch(error){
    if(directUrl===data.signedUrl)throw error
    return xhrPut(data.signedUrl,path,file,options,entry)
  }
}

async function resumableUpload(path:string,file:Blob,options:UploadOptions,entry:ActiveUpload){
  const {data}=await signedUpload(path)
  const token=data.token
  return new Promise<UploadResult>((resolve,reject)=>{
    let settled=false
    const finish=(fn:(value:any)=>void,value:any)=>{if(settled)return;settled=true;fn(value)}
    const upload=new tus.Upload(file,{
      endpoint:TUS_ENDPOINT,
      retryDelays:[0,1000,3000,5000,10000,20000],
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY,'x-signature':token,'x-upsert':'false'},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{
        bucketName:CHAT_BUCKET,
        objectName:path,
        contentType:options.contentType||file.type||'application/octet-stream',
        cacheControl:String(options.cacheControl||'31536000')
      },
      chunkSize:CHUNK_SIZE,
      onProgress:(uploaded,total)=>emit(entry,uploaded,total),
      onError:error=>finish(reject,error),
      onSuccess:()=>{emit(entry,file.size,file.size);finish(resolve,{data:{path},error:null})}
    })
    void upload.findPreviousUploads().then(previous=>{
      if(previous.length){try{upload.resumeFromPreviousUpload(previous[0])}catch{}}
      upload.start()
    }).catch(()=>upload.start())
  })
}

async function standardUpload(path:string,file:Blob,options:UploadOptions,entry:ActiveUpload):Promise<UploadResult>{
  emit(entry,0,file.size)
  const {error}=await supabase.storage.from(CHAT_BUCKET).upload(path,file,{
    contentType:options.contentType||file.type||'application/octet-stream',
    cacheControl:options.cacheControl||'31536000',
    upsert:false
  })
  if(error&&!alreadyExists(error))throw error
  emit(entry,file.size,file.size)
  return{data:{path},error:null}
}

export function uploadChatMedia(path:string,file:Blob,options:UploadOptions={}):Promise<UploadResult>{
  const existing=activeUploads.get(path)
  if(existing){
    if(options.onProgress)existing.listeners.add(options.onProgress)
    return existing.promise
  }

  const entry:ActiveUpload={promise:Promise.resolve(null as any),listeners:new Set()}
  if(options.onProgress)entry.listeners.add(options.onProgress)
  entry.promise=(async()=>{
    try{
      if(file.size<=RESUMABLE_THRESHOLD)return await standardUpload(path,file,options,entry)
      try{return await resumableUpload(path,file,options,entry)}
      catch(tusError){
        console.warn('Resumable Chat upload failed; using signed upload fallback.',tusError)
        return await signedProgressUpload(path,file,options,entry)
      }
    }finally{
      activeUploads.delete(path)
    }
  })()
  activeUploads.set(path,entry)
  return entry.promise
}

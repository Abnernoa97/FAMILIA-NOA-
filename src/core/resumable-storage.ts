import * as tus from 'tus-js-client'
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../supabase'

const MEDIA_BUCKET='family-photos'
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

async function authToken(){
  const {data:{session},error}=await supabase.auth.getSession()
  if(error)throw error
  if(!session?.access_token)throw new Error('MEDIA_AUTH_SESSION_MISSING')
  return session.access_token
}

async function signedSdkUpload(path:string,file:Blob,options:UploadOptions,entry:ActiveUpload):Promise<UploadResult>{
  const api=supabase.storage.from(MEDIA_BUCKET)
  emit(entry,0,file.size)
  const {data,error}=await api.createSignedUploadUrl(path,{upsert:false})
  if(error||!data?.token)throw error||new Error('MEDIA_SIGNED_UPLOAD_UNAVAILABLE')
  const {error:uploadError}=await api.uploadToSignedUrl(path,data.token,file,{
    contentType:options.contentType||file.type||'application/octet-stream',
    cacheControl:options.cacheControl||'31536000',
    upsert:false
  })
  if(uploadError&&!alreadyExists(uploadError))throw uploadError
  emit(entry,file.size,file.size)
  return{data:{path},error:null}
}

async function resumableUpload(path:string,file:Blob,options:UploadOptions,entry:ActiveUpload){
  const accessToken=await authToken()
  return new Promise<UploadResult>((resolve,reject)=>{
    let settled=false
    const finish=(fn:(value:any)=>void,value:any)=>{if(settled)return;settled=true;fn(value)}
    const upload=new tus.Upload(file,{
      endpoint:TUS_ENDPOINT,
      retryDelays:[0,1000,3000,5000,10000,20000],
      headers:{
        authorization:`Bearer ${accessToken}`,
        apikey:SUPABASE_PUBLISHABLE_KEY,
        'x-upsert':'false'
      },
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{
        bucketName:MEDIA_BUCKET,
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
  const {error}=await supabase.storage.from(MEDIA_BUCKET).upload(path,file,{
    contentType:options.contentType||file.type||'application/octet-stream',
    cacheControl:options.cacheControl||'31536000',
    upsert:false
  })
  if(error&&!alreadyExists(error))throw error
  emit(entry,file.size,file.size)
  return{data:{path},error:null}
}

export function uploadPrivateMedia(path:string,file:Blob,options:UploadOptions={}):Promise<UploadResult>{
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
        console.warn('Resumable media upload failed; using Supabase signed upload fallback.',tusError)
        return await signedSdkUpload(path,file,options,entry)
      }
    }finally{
      activeUploads.delete(path)
    }
  })()
  activeUploads.set(path,entry)
  return entry.promise
}

export const uploadChatMedia=uploadPrivateMedia

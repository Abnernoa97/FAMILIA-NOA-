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

function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms))}

function encodedObjectPath(path:string){
  return path.split('/').map(segment=>encodeURIComponent(segment)).join('/')
}

async function verifyObject(path:string){
  let lastError:any=null
  for(let attempt=0;attempt<5;attempt++){
    const {data,error}=await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path,60)
    if(!error&&data?.signedUrl)return
    lastError=error
    if(attempt<4)await delay(250*(attempt+1))
  }
  throw lastError||new Error('MEDIA_UPLOAD_NOT_PERSISTED')
}

async function authToken(){
  const {data:{session},error}=await supabase.auth.getSession()
  if(error)throw error
  if(!session?.access_token)throw new Error('MEDIA_AUTH_SESSION_MISSING')
  return session.access_token
}

async function rawBinaryUpload(path:string,file:Blob,options:UploadOptions,entry:ActiveUpload):Promise<UploadResult>{
  const accessToken=await authToken()
  const url=`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(MEDIA_BUCKET)}/${encodedObjectPath(path)}`
  emit(entry,0,file.size)

  await new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest()
    xhr.open('POST',url,true)
    xhr.setRequestHeader('Authorization',`Bearer ${accessToken}`)
    xhr.setRequestHeader('apikey',SUPABASE_PUBLISHABLE_KEY)
    xhr.setRequestHeader('Content-Type',options.contentType||file.type||'application/octet-stream')
    xhr.setRequestHeader('cache-control',options.cacheControl||'31536000')
    xhr.upload.onprogress=event=>{if(event.lengthComputable)emit(entry,event.loaded,event.total)}
    xhr.onerror=()=>reject(new Error('MEDIA_UPLOAD_NETWORK_ERROR'))
    xhr.onabort=()=>reject(new Error('MEDIA_UPLOAD_ABORTED'))
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300){resolve();return}
      let message=`MEDIA_UPLOAD_FAILED_${xhr.status}`
      try{
        const parsed=JSON.parse(xhr.responseText||'{}')
        message=String(parsed?.message||parsed?.error||parsed?.code||message)
      }catch{}
      reject(new Error(message))
    }
    xhr.send(file)
  })

  await verifyObject(path)
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
        apikey:SUPABASE_PUBLISHABLE_KEY
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
      onSuccess:()=>finish(resolve,{data:{path},error:null})
    })
    // Every media item gets a fresh UUID path. Do not resume a previous browser
    // fingerprint because camera captures often reuse the same local filename.
    upload.start()
  })
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
      if(file.size<=RESUMABLE_THRESHOLD)return await rawBinaryUpload(path,file,options,entry)
      try{
        const result=await resumableUpload(path,file,options,entry)
        await verifyObject(path)
        emit(entry,file.size,file.size)
        return result
      }catch(tusError){
        console.warn('Resumable media upload failed; using raw binary fallback.',tusError)
        return await rawBinaryUpload(path,file,options,entry)
      }
    }finally{
      activeUploads.delete(path)
    }
  })()
  activeUploads.set(path,entry)
  return entry.promise
}

export const uploadChatMedia=uploadPrivateMedia

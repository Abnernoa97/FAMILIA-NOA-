import * as tus from 'tus-js-client'
import { supabase, SUPABASE_URL } from '../supabase'

const CHAT_BUCKET = 'family-photos'
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024
const CHUNK_SIZE = 6 * 1024 * 1024
const PROJECT_ID = new URL(SUPABASE_URL).hostname.split('.')[0]
const ENDPOINT = `https://${PROJECT_ID}.storage.supabase.co/storage/v1/upload/resumable`
const PATCH_FLAG = '__familiaNoaResumableUploads'

function pendingId(path:string){
  const match=path.match(/\/([0-9a-f-]{36})\.[^/]+$/i)
  return match?.[1]||''
}

function showProgress(path:string,uploaded:number,total:number){
  const id=pendingId(path)
  if(!id||!total)return
  const meta=document.querySelector<HTMLElement>(`[data-pending-id="${CSS.escape(id)}"] [data-pending-state]`)
  if(!meta)return
  const percent=Math.max(0,Math.min(100,Math.round(uploaded/total*100)))
  meta.innerHTML=percent>=100
    ? '<span class="chat-spinner"></span> Guardando…'
    : `<span class="chat-spinner"></span> Subiendo ${percent}%`
}

async function resumableUpload(path:string,file:Blob,options:any={}){
  const { data:{ session }, error }=await supabase.auth.getSession()
  if(error||!session?.access_token)throw error||new Error('CHAT_UPLOAD_SESSION_REQUIRED')

  return new Promise<{data:{path:string};error:null}>((resolve,reject)=>{
    const upload=new tus.Upload(file,{
      endpoint:ENDPOINT,
      retryDelays:[0,1000,3000,5000,10000,20000],
      headers:{
        authorization:`Bearer ${session.access_token}`,
        'x-upsert':'true'
      },
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{
        bucketName:CHAT_BUCKET,
        objectName:path,
        contentType:options?.contentType||file.type||'application/octet-stream',
        cacheControl:String(options?.cacheControl||'31536000')
      },
      chunkSize:CHUNK_SIZE,
      onError:error=>reject(error),
      onProgress:(uploaded,total)=>showProgress(path,uploaded,total),
      onSuccess:()=>{
        showProgress(path,file.size,file.size)
        resolve({data:{path},error:null})
      }
    })

    void upload.findPreviousUploads().then(previous=>{
      if(previous.length)upload.resumeFromPreviousUpload(previous[0])
      upload.start()
    }).catch(reject)
  })
}

export function installResumableChatUploads(){
  const storage:any=supabase.storage
  if(storage[PATCH_FLAG])return
  storage[PATCH_FLAG]=true

  const originalFrom=storage.from.bind(storage)
  storage.from=(bucket:string)=>{
    const api:any=originalFrom(bucket)
    if(bucket!==CHAT_BUCKET)return api

    const originalUpload=api.upload.bind(api)
    api.upload=async(path:string,body:any,options:any={})=>{
      const isChat=typeof path==='string'&&path.startsWith('chat/')
      const isBlob=typeof Blob!=='undefined'&&body instanceof Blob
      if(isChat&&isBlob&&body.size>RESUMABLE_THRESHOLD){
        return resumableUpload(path,body,options)
      }
      return originalUpload(path,body,options)
    }
    return api
  }
}

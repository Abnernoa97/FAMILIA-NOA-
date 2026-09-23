import { supabase } from '../supabase'
import { isVideoStoragePath, videoPosterPath } from './video-poster'

const BUCKET = 'family-photos'
const TTL_SECONDS = 60 * 60
const CACHE_SKEW_MS = 60 * 1000
const SIGN_TIMEOUT_MS = 3500
const cache = new Map<string,{url:string;expires:number}>()

function timeoutAfter<T>(promise:Promise<T>,ms=SIGN_TIMEOUT_MS){
  return new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error('PRIVATE_MEDIA_TIMEOUT')),ms)
    promise.then(
      value=>{window.clearTimeout(timer);resolve(value)},
      error=>{window.clearTimeout(timer);reject(error)}
    )
  })
}

export function mediaUrl(path:string|null|undefined){
  if(!path)return ''
  const item=cache.get(path)
  if(!item||item.expires<=Date.now()){
    cache.delete(path)
    return ''
  }
  return item.url
}

function remember(path:string,url:string){
  cache.set(path,{url,expires:Date.now()+(TTL_SECONDS*1000)-CACHE_SKEW_MS})
  return url
}

export async function signMedia(path:string|null|undefined){
  if(!path)return ''
  const current=mediaUrl(path)
  if(current)return current
  const {data,error}=await timeoutAfter(
    supabase.storage.from(BUCKET).createSignedUrl(path,TTL_SECONDS),
    SIGN_TIMEOUT_MS
  )
  if(error||!data?.signedUrl)throw error||new Error('No se pudo autorizar el archivo.')
  return remember(path,data.signedUrl)
}

export async function primeMedia(paths:Array<string|null|undefined>){
  let missing=[...new Set(paths.filter((path):path is string=>!!path&&!mediaUrl(path)))]
  if(!missing.length)return

  try{
    const {data,error}=await timeoutAfter(
      supabase.storage.from(BUCKET).createSignedUrls(missing,TTL_SECONDS),
      SIGN_TIMEOUT_MS
    )
    if(!error&&data){
      const unresolved:string[]=[]
      data.forEach((item:any,index:number)=>{
        const path=(item?.path as string|undefined)||missing[index]
        if(path&&item?.signedUrl)remember(path,item.signedUrl)
        else if(path)unresolved.push(path)
      })
      missing=unresolved
      if(!missing.length)return
    }
  }catch(error){
    console.warn('Private media batch signing timed out or failed',error)
  }

  // A missing or slow private object must never block the screen that requested it.
  // Retry unresolved items in the background and let the UI continue immediately.
  void Promise.allSettled(missing.map(path=>signMedia(path))).then(()=>undefined)
}

export function forgetMedia(path:string|null|undefined){
  if(path)cache.delete(path)
}

function chatMessageId(path:string){
  const match=path.match(/^chat\/[0-9a-f-]{36}\/([0-9a-f-]{36})\.[^/]+$/i)
  return match?.[1]||''
}

function missingObject(error:any){
  const message=String(error?.message||error||'').toLowerCase()
  const status=Number(error?.statusCode||error?.status||0)
  return status===404||message.includes('not found')||message.includes('does not exist')
}

export async function removeMedia(path:string|null|undefined){
  if(!path)return
  const paths=isVideoStoragePath(path)?[path,videoPosterPath(path)]:[path]
  const {error}=await supabase.storage.from(BUCKET).remove(paths)
  if(error&&!missingObject(error))throw error
  paths.forEach(forgetMedia)

  const messageId=chatMessageId(path)
  if(messageId){
    const {error:finalizeError}=await supabase.rpc('finalize_chat_media_delete',{p_message_id:messageId})
    if(finalizeError)throw finalizeError
  }
}
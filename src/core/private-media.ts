import { supabase } from '../supabase'
import { isVideoStoragePath, videoPosterPath } from './video-poster'

const BUCKET = 'family-photos'
const TTL_SECONDS = 60 * 60
const CACHE_SKEW_MS = 60 * 1000
const SIGN_TIMEOUT_MS = 3500
const MISSING_TTL_MS = 30 * 60 * 1000
const cache = new Map<string,{url:string;expires:number}>()
const missingCache = new Map<string,number>()

function timeoutAfter<T>(promise:Promise<T>,ms=SIGN_TIMEOUT_MS){
  return new Promise<T>((resolve,reject)=>{
    const timer=window.setTimeout(()=>reject(new Error('PRIVATE_MEDIA_TIMEOUT')),ms)
    promise.then(
      value=>{window.clearTimeout(timer);resolve(value)},
      error=>{window.clearTimeout(timer);reject(error)}
    )
  })
}

function missingObject(error:any){
  const message=String(error?.message||error||'').toLowerCase()
  const status=Number(error?.statusCode||error?.status||0)
  return status===400||status===404||message.includes('not found')||message.includes('does not exist')||message.includes('object not found')
}

function knownMissing(path:string){
  const until=missingCache.get(path)||0
  if(until>Date.now())return true
  if(until)missingCache.delete(path)
  return false
}

function rememberMissing(path:string){
  cache.delete(path)
  missingCache.set(path,Date.now()+MISSING_TTL_MS)
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
  missingCache.delete(path)
  cache.set(path,{url,expires:Date.now()+(TTL_SECONDS*1000)-CACHE_SKEW_MS})
  return url
}

export async function signMedia(path:string|null|undefined){
  if(!path||knownMissing(path))return ''
  const current=mediaUrl(path)
  if(current)return current
  try{
    const {data,error}=await timeoutAfter(
      supabase.storage.from(BUCKET).createSignedUrl(path,TTL_SECONDS),
      SIGN_TIMEOUT_MS
    )
    if(error||!data?.signedUrl){
      if(missingObject(error))rememberMissing(path)
      throw error||new Error('No se pudo autorizar el archivo.')
    }
    return remember(path,data.signedUrl)
  }catch(error){
    if(missingObject(error))rememberMissing(path)
    throw error
  }
}

export async function primeMedia(paths:Array<string|null|undefined>){
  let missing=[...new Set(paths.filter((path):path is string=>!!path&&!knownMissing(path)&&!mediaUrl(path)))]
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
        else if(path)rememberMissing(path)
      })
      missing=unresolved
      if(!missing.length)return
    }
  }catch(error){
    console.warn('Private media batch signing timed out or failed',error)
  }

  // Only retry after a true batch failure/timeout. Objects explicitly missing from a
  // successful batch are negatively cached so the app does not hammer Storage with 400s.
  void Promise.allSettled(missing.filter(path=>!knownMissing(path)).map(path=>signMedia(path))).then(()=>undefined)
}

export function forgetMedia(path:string|null|undefined){
  if(path){
    cache.delete(path)
    missingCache.delete(path)
  }
}

function chatMessageId(path:string){
  const match=path.match(/^chat\/[0-9a-f-]{36}\/([0-9a-f-]{36})\.[^/]+$/i)
  return match?.[1]||''
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

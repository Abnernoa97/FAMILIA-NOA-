import { supabase } from '../supabase'

const BUCKET = 'family-photos'
const TTL_SECONDS = 60 * 60
const CACHE_SKEW_MS = 60 * 1000
const cache = new Map<string,{url:string;expires:number}>()

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
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,TTL_SECONDS)
  if(error||!data?.signedUrl)throw error||new Error('No se pudo autorizar el archivo.')
  return remember(path,data.signedUrl)
}

export async function primeMedia(paths:Array<string|null|undefined>){
  let missing=[...new Set(paths.filter((path):path is string=>!!path&&!mediaUrl(path)))]
  if(!missing.length)return

  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrls(missing,TTL_SECONDS)
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

  await Promise.all(missing.map(async path=>{
    try{await signMedia(path)}catch{cache.delete(path)}
  }))
}

export function forgetMedia(path:string|null|undefined){
  if(path)cache.delete(path)
}

export async function removeMedia(path:string|null|undefined){
  if(!path)return
  const {error}=await supabase.storage.from(BUCKET).remove([path])
  if(error)throw error
  forgetMedia(path)
}

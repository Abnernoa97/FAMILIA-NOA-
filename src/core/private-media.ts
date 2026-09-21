import { supabase } from '../supabase'

const BUCKET = 'family-photos'
const TTL_SECONDS = 60 * 60
const cache = new Map<string,{url:string;expires:number}>()

export function mediaUrl(path:string|null|undefined){
  if(!path)return ''
  const item=cache.get(path)
  return item && item.expires>Date.now() ? item.url : ''
}

export async function signMedia(path:string|null|undefined){
  if(!path)return ''
  const current=mediaUrl(path)
  if(current)return current
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(path,TTL_SECONDS)
  if(error||!data?.signedUrl)throw error||new Error('No se pudo autorizar la foto.')
  cache.set(path,{url:data.signedUrl,expires:Date.now()+(TTL_SECONDS-60)*1000})
  return data.signedUrl
}

export async function primeMedia(paths:Array<string|null|undefined>){
  const unique=[...new Set(paths.filter((p):p is string=>!!p))]
  await Promise.all(unique.map(async path=>{try{await signMedia(path)}catch{cache.delete(path)}}))
}

export function forgetMedia(path:string|null|undefined){
  if(path)cache.delete(path)
}

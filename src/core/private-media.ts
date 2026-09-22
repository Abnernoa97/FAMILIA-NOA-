import { supabase } from '../supabase'

const LEGACY_BUCKET = 'family-photos'
const LEGACY_TTL_SECONDS = 60 * 60
const R2_PREFIX = 'r2:'
const cache = new Map<string,{url:string;expires:number}>()
let mediaSessionToken = ''

function isR2(path:string){
  return path.startsWith(R2_PREFIX)
}

function r2Key(path:string){
  return path.slice(R2_PREFIX.length)
}

function r2Url(path:string){
  const key = r2Key(path).split('/').map(encodeURIComponent).join('/')
  return `/api/media/object/${key}`
}

async function accessToken(){
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data.session?.access_token || ''
  if (!token) throw new Error('No hay una sesión familiar activa.')
  return token
}

async function ensureR2Session(){
  const token = await accessToken()
  if (mediaSessionToken === token) return token
  const response = await fetch('/api/media/session', {
    method:'POST',
    headers:{ authorization:`Bearer ${token}` }
  })
  if (!response.ok) throw new Error('No se pudo autorizar el almacenamiento privado.')
  mediaSessionToken = token
  return token
}

export function mediaUrl(path:string|null|undefined){
  if(!path)return ''
  const item=cache.get(path)
  return item && item.expires>Date.now() ? item.url : ''
}

export async function signMedia(path:string|null|undefined){
  if(!path)return ''
  const current=mediaUrl(path)
  if(current)return current

  if(isR2(path)){
    await ensureR2Session()
    const url=r2Url(path)
    cache.set(path,{url,expires:Date.now()+50*60*1000})
    return url
  }

  const {data,error}=await supabase.storage.from(LEGACY_BUCKET).createSignedUrl(path,LEGACY_TTL_SECONDS)
  if(error||!data?.signedUrl)throw error||new Error('No se pudo autorizar la foto.')
  cache.set(path,{url:data.signedUrl,expires:Date.now()+(LEGACY_TTL_SECONDS-60)*1000})
  return data.signedUrl
}

export async function primeMedia(paths:Array<string|null|undefined>){
  const unique=[...new Set(paths.filter((p):p is string=>!!p))]
  const r2=unique.filter(isR2)
  const legacy=unique.filter(path=>!isR2(path))

  if(r2.length){
    try{
      await ensureR2Session()
      const expires=Date.now()+50*60*1000
      r2.forEach(path=>cache.set(path,{url:r2Url(path),expires}))
    }catch{
      r2.forEach(path=>cache.delete(path))
    }
  }

  await Promise.all(legacy.map(async path=>{try{await signMedia(path)}catch{cache.delete(path)}}))
}

export async function uploadMedia(path:string,blob:Blob,contentType:string){
  if(!isR2(path))throw new Error('La ruta de Cloudflare R2 no es válida.')
  const token=await accessToken()
  const response=await fetch(r2Url(path),{
    method:'PUT',
    headers:{authorization:`Bearer ${token}`,'content-type':contentType},
    body:blob
  })
  if(!response.ok)throw new Error(`No se pudo subir el archivo (${response.status}).`)
  await ensureR2Session()
  cache.set(path,{url:r2Url(path),expires:Date.now()+50*60*1000})
  return path
}

export async function removeMedia(path:string|null|undefined){
  if(!path)return
  cache.delete(path)
  if(isR2(path)){
    const token=await accessToken()
    const response=await fetch(r2Url(path),{method:'DELETE',headers:{authorization:`Bearer ${token}`}})
    if(!response.ok && response.status!==404)throw new Error(`No se pudo eliminar el archivo (${response.status}).`)
    return
  }
  const {error}=await supabase.storage.from(LEGACY_BUCKET).remove([path])
  if(error)throw error
}

export function forgetMedia(path:string|null|undefined){
  if(path)cache.delete(path)
}

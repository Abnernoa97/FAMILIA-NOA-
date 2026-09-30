import { supabase } from './supabase'

type Member={id:string;name:string}
type MessageRow={sender_id:string;body:string|null;created_at:string;attachment_type:string|null;attachment_name:string|null}
type PhotoRow={uploader_id:string;caption:string|null;created_at:string}
type PostRow={member_id:string;body:string|null;media_type:string|null;is_prompt_response:boolean|null;created_at:string}

const functions:any=supabase.functions
const originalInvoke=functions.invoke.bind(functions)

function norm(value:string){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
}

function clip(value:unknown,max=150){
  const text=String(value||'').replace(/\s+/g,' ').trim()
  return text.length>max?`${text.slice(0,max-1)}…`:text
}

function mexicoStart(offsetDays=0){
  const now=new Date(Date.now()+offsetDays*86400000)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const get=(type:string)=>parts.find(part=>part.type===type)?.value||''
  return new Date(`${get('year')}-${get('month')}-${get('day')}T06:00:00.000Z`).toISOString()
}

function attachmentLabel(row:MessageRow){
  const body=clip(row.body,170)
  if(body)return body
  const type=String(row.attachment_type||'').toLowerCase()
  if(type.startsWith('image'))return 'envió una foto'
  if(type.startsWith('audio'))return 'envió un audio'
  if(type.startsWith('video'))return 'envió un video'
  if(row.attachment_name)return `envió ${clip(row.attachment_name,70)}`
  return 'envió un archivo'
}

function humanList(items:string[]){
  if(!items.length)return 'nadie'
  if(items.length===1)return items[0]
  if(items.length===2)return `${items[0]} y ${items[1]}`
  return `${items.slice(0,-1).join(', ')} y ${items.at(-1)}`
}

async function richFamilyAnswer(question:string):Promise<string|null>{
  const q=norm(question)
  const isYesterday=q.includes('ayer')
  const start=mexicoStart(isYesterday?-1:0)
  const end=isYesterday?mexicoStart(0):new Date().toISOString()

  const shouldInspectMessages=
    !q||q.includes('resumen')||q.includes('perdi')||q.includes('que paso')||q.includes('que hicieron')||
    q.includes('chat')||q.includes('mensaje')||q.includes('escrib')||q.includes('dij')||
    q.includes('actualiz')||q.includes('cambio')||q.includes('nuevo')

  const shouldInspectPeople=shouldInspectMessages||q.includes('hizo')||q.includes('actividad')||q.includes('activo')
  if(!shouldInspectPeople&& !q.includes('foto') && !q.includes('presume'))return null

  const [membersQ,messagesQ,photosQ,postsQ]=await Promise.all([
    supabase.from('family_members').select('id,name').eq('active',true),
    supabase.from('messages').select('sender_id,body,created_at,attachment_type,attachment_name').is('deleted_at',null).gte('created_at',start).lt('created_at',end).order('created_at',{ascending:false}).limit(160),
    supabase.from('photos').select('uploader_id,caption,created_at').gte('created_at',start).lt('created_at',end).order('created_at',{ascending:false}).limit(120),
    supabase.from('social_posts').select('member_id,body,media_type,is_prompt_response,created_at').gte('created_at',start).lt('created_at',end).order('created_at',{ascending:false}).limit(120),
  ])

  if(membersQ.error||messagesQ.error||photosQ.error||postsQ.error)return null

  const members=(membersQ.data||[]) as Member[]
  const messages=(messagesQ.data||[]) as MessageRow[]
  const photos=(photosQ.data||[]) as PhotoRow[]
  const posts=(postsQ.data||[]) as PostRow[]
  const names=new Map(members.map(member=>[member.id,member.name]))
  const dayLabel=isYesterday?'Ayer':'Hoy'

  const counts=new Map<string,number>()
  messages.forEach(row=>counts.set(row.sender_id,(counts.get(row.sender_id)||0)+1))
  const writers=[...counts.entries()]
    .map(([id,count])=>({id,name:names.get(id)||'Familia',count}))
    .sort((a,b)=>b.count-a.count)

  const mentioned=members.find(member=>q.includes(norm(member.name)))
  if(mentioned){
    const mine=messages.filter(row=>row.sender_id===mentioned.id)
    const minePhotos=photos.filter(row=>row.uploader_id===mentioned.id)
    const minePosts=posts.filter(row=>row.member_id===mentioned.id)
    if(!mine.length&&!minePhotos.length&&!minePosts.length)return `${mentioned.name} no tiene actividad registrada ${isYesterday?'ayer':'hoy'}.`
    const parts:string[]=[]
    if(mine.length)parts.push(`${mentioned.name} escribió ${mine.length} mensaje${mine.length===1?'':'s'}`)
    if(minePhotos.length)parts.push(`subió ${minePhotos.length} foto${minePhotos.length===1?'':'s'}`)
    if(minePosts.length)parts.push(`compartió ${minePosts.length} momento${minePosts.length===1?'':'s'} en PRESUME`)
    const recent=mine.slice(0,4).map(row=>`“${attachmentLabel(row)}”`).join(' · ')
    return `${parts.join(', ')} ${isYesterday?'ayer':'hoy'}.${recent?` Lo más reciente: ${recent}`:''}`
  }

  if(q.includes('quien escribio')||q.includes('quienes escribieron')||q.includes('que dijeron')||q.includes('que dijo')||q.includes('chat de hoy')||q.includes('chat de ayer')){
    if(!messages.length)return `${dayLabel} todavía no hubo mensajes en el chat.`
    const who=writers.slice(0,6).map(item=>`${item.name} (${item.count})`).join(', ')
    const latest=messages.slice(0,6).map(row=>`${names.get(row.sender_id)||'Familia'}: “${attachmentLabel(row)}”`).join('\n')
    return `${dayLabel} escribieron: ${who}.\n${latest}`
  }

  if(q.includes('actualiz')||q.includes('cambio')||q.includes('que hay de nuevo')||q.includes('nuevo')){
    const latest=messages.slice(0,4).map(row=>`${names.get(row.sender_id)||'Familia'}: “${attachmentLabel(row)}”`).join(' · ')
    return `${dayLabel} hubo ${messages.length} mensaje${messages.length===1?'':'s'}, ${photos.length} foto${photos.length===1?'':'s'} y ${posts.length} momento${posts.length===1?'':'s'} en PRESUME.${latest?` Lo último: ${latest}`:''}`
  }

  if(q.includes('foto')){
    if(!photos.length)return `${dayLabel} no se han subido fotos todavía.`
    const byPerson=new Map<string,number>()
    photos.forEach(row=>byPerson.set(row.uploader_id,(byPerson.get(row.uploader_id)||0)+1))
    const detail=[...byPerson.entries()].map(([id,count])=>`${names.get(id)||'Familia'} (${count})`).join(', ')
    return `${dayLabel} se compartieron ${photos.length} foto${photos.length===1?'':'s'}: ${detail}.`
  }

  if(q.includes('presume')){
    const promptPosts=posts.filter(row=>row.is_prompt_response===true)
    if(!promptPosts.length)return `${dayLabel} todavía nadie ha completado el PRESUME.`
    const done=[...new Set(promptPosts.map(row=>names.get(row.member_id)||'Familia'))]
    return `${dayLabel} ya hicieron PRESUME: ${humanList(done)}.`
  }

  if(!q||q.includes('resumen')||q.includes('perdi')||q.includes('que paso')||q.includes('que hicieron')){
    const activeIds=new Set<string>()
    messages.forEach(row=>activeIds.add(row.sender_id))
    photos.forEach(row=>activeIds.add(row.uploader_id))
    posts.forEach(row=>activeIds.add(row.member_id))
    const active=members.filter(member=>activeIds.has(member.id)).map(member=>member.name)
    const latest=messages.slice(0,3).map(row=>`${names.get(row.sender_id)||'Familia'}: “${attachmentLabel(row)}”`).join(' · ')
    return `${dayLabel} hubo ${messages.length} mensaje${messages.length===1?'':'s'}, ${photos.length} foto${photos.length===1?'':'s'} y ${posts.length} momento${posts.length===1?'':'s'} en PRESUME.${active.length?` Estuvieron activos ${humanList(active)}.`:''}${latest?` Lo más reciente en Chat: ${latest}`:''}`
  }

  return null
}

functions.invoke=async function(functionName:string,options?:any){
  const result=await originalInvoke(functionName,options)
  if(functionName!=='family-assistant'||!result?.data?.ok)return result
  try{
    const question=String(options?.body?.question||'')
    const richer=await richFamilyAnswer(question)
    if(richer)return {...result,data:{...result.data,text:richer}}
  }catch(error){
    console.warn('NOA rich family context failed',error)
  }
  return result
}

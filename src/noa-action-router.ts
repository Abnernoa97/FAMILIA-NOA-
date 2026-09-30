import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { enterView } from './core/navigation'
import { closeChat, openChat } from './chat-core'

type Member={id:string;name:string}
type PhotoTarget={id:string;uploader_id:string;created_at:string}

const functions:any=supabase.functions
const originalInvoke=functions.invoke.bind(functions)
const CONTEXT_KEY='familia-noa-noa-conversation-context'

function norm(value:string){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
}

function mexicoStart(offsetDays=0){
  const now=new Date(Date.now()+offsetDays*86400000)
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const get=(type:string)=>parts.find(part=>part.type===type)?.value||''
  return new Date(`${get('year')}-${get('month')}-${get('day')}T06:00:00.000Z`).toISOString()
}

function readContext(){
  try{return JSON.parse(sessionStorage.getItem(CONTEXT_KEY)||'{}') as {subjectId?:string;subjectName?:string;dayOffset?:0|-1}}
  catch{return {}}
}

function closeNoaModal(){
  const back=document.querySelector<HTMLButtonElement>('.noa-modal .noa-back')
  if(back)back.click()
}

async function familyMembers():Promise<Member[]>{
  const {data,error}=await supabase.from('family_members').select('id,name').eq('active',true).order('created_at')
  if(error)throw error
  return (data||[]) as Member[]
}

async function navigateChat(){
  const identity=getIdentity()
  const app=document.querySelector<HTMLElement>('#app')
  if(!identity?.memberId||!app)return
  const members=await familyMembers()
  closeNoaModal()
  closeChat()
  enterView('chat')
  await openChat({
    app,
    memberId:identity.memberId,
    memberName:identity.name,
    members,
    notify:(title,text)=>console.info(`NOA ${title}: ${text}`),
  })
}

async function sendChatMessage(body:string){
  const identity=getIdentity()
  if(!identity?.memberId)throw new Error('NO_IDENTITY')
  const clean=body.replace(/^[:\s,.-]+/,'').trim().slice(0,2000)
  if(!clean)throw new Error('EMPTY_MESSAGE')
  const id=crypto.randomUUID()
  const {error}=await supabase.from('messages').insert({id,sender_id:identity.memberId,body:clean})
  if(error)throw error
  return clean
}

function extractChatSend(question:string){
  const text=String(question||'').trim()
  const patterns=[
    /^\s*(?:noa[,:]?\s*)?(?:escribe|manda|env[ií]a|publica)\s+(?:en\s+)?(?:el\s+)?chat\s*(?:que\s+)?[:,-]?\s*(.+)$/i,
    /^\s*(?:noa[,:]?\s*)?(?:dile|diles)\s+(?:a\s+)?(?:la\s+)?familia\s+(?:por\s+|en\s+)?(?:el\s+)?chat\s*(?:que\s+)?[:,-]?\s*(.+)$/i,
  ]
  for(const pattern of patterns){
    const match=text.match(pattern)
    if(match?.[1]?.trim())return match[1].trim()
  }
  return ''
}

async function resolvePhoto(question:string):Promise<PhotoTarget|null>{
  const q=norm(question)
  const members=await familyMembers()
  const context=readContext()
  const explicit=members.find(member=>q.includes(norm(member.name)))
  const subjectId=explicit?.id||context.subjectId||''
  const dayOffset:0|-1=q.includes('ayer')?-1:q.includes('hoy')?0:(context.dayOffset===-1?-1:0)
  let query=supabase.from('photos').select('id,uploader_id,created_at').gte('created_at',mexicoStart(dayOffset)).order('created_at',{ascending:false}).limit(1)
  if(dayOffset===-1)query=query.lt('created_at',mexicoStart(0))
  if(subjectId)query=query.eq('uploader_id',subjectId)
  const {data,error}=await query
  if(error)throw error
  return ((data||[])[0]||null) as PhotoTarget|null
}

function waitFor<T extends Element>(selector:string,timeout=5000):Promise<T|null>{
  return new Promise(resolve=>{
    const started=Date.now()
    const tick=()=>{
      const found=document.querySelector<T>(selector)
      if(found)return resolve(found)
      if(Date.now()-started>=timeout)return resolve(null)
      window.setTimeout(tick,100)
    }
    tick()
  })
}

async function navigatePhoto(target:PhotoTarget|null){
  const app=document.querySelector<HTMLElement>('#app')
  if(!app)return
  closeNoaModal()
  closeChat()
  enterView('photos')
  app.innerHTML='<main class="page photo-page" data-photo-page><div class="loading">Cargando álbumes…</div></main>'
  if(!target)return
  const direct=await waitFor<HTMLElement>(`[data-photo-id="${CSS.escape(target.id)}"]`,1200)
  if(direct){direct.click();return}
  const album=await waitFor<HTMLButtonElement>(`[data-album-id="${CSS.escape(target.uploader_id)}"]`,5000)
  album?.click()
  const photo=await waitFor<HTMLButtonElement>(`[data-photo-id="${CSS.escape(target.id)}"]`,5000)
  photo?.click()
}

function isChatLookup(q:string){
  return q.includes('chat')||q.includes('mensaje')||q.includes('escribio')||q.includes('escribieron')||q.includes('que dijo')||q.includes('que dijeron')||q.includes('dijo')
}

function isPhotoLookup(q:string){
  return q.includes('foto')||q.includes('fotos')||q.includes('imagen')||q.includes('album')
}

functions.invoke=async function(functionName:string,options?:any){
  const question=String(options?.body?.question||'')
  const chatText=functionName==='family-assistant'?extractChatSend(question):''
  const result=await originalInvoke(functionName,options)
  if(functionName!=='family-assistant'||!result?.data?.ok)return result

  if(chatText){
    try{
      const sent=await sendChatMessage(chatText)
      result.data.text=`Listo. Ya lo envié al chat: “${sent}”`
      window.setTimeout(()=>{void navigateChat()},650)
    }catch(error){
      console.error('NOA chat action failed',error)
      result.data.text='Entendí el mensaje, pero no pude enviarlo al chat. Inténtalo otra vez.'
    }
    return result
  }

  const q=norm(question)
  if(isPhotoLookup(q)){
    void resolvePhoto(question).then(target=>window.setTimeout(()=>{void navigatePhoto(target)},700)).catch(error=>console.warn('NOA photo navigation failed',error))
  }else if(isChatLookup(q)){
    window.setTimeout(()=>{void navigateChat()},700)
  }
  return result
}

;(window as any).__familiaNoaNoaActions={
  openChat:()=>void navigateChat(),
  openLatestPhoto:()=>void resolvePhoto('foto').then(navigatePhoto),
}

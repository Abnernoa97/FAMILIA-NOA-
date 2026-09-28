import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { mediaUrl, primeMedia, signMedia } from './core/private-media'
import { openMediaViewer } from './core/media-viewer'
import { enterView } from './core/navigation'

type FeaturedRow={
  member_id:string
  slot:number
  storage_path:string
  source_type:'album'|'chat'|'profile'
  source_photo_id:string|null
  created_at:string
}

let activeMemberId=''
let renderTimer:number|null=null
let rendering=false
let mutationBusy=false
let realtimeChannel:ReturnType<typeof supabase.channel>|null=null
let realtimeMemberId=''

function esc(value:string){
  return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[char]||char))
}

function injectStyles(){
  if(document.querySelector('#profile-featured-media-css'))return
  const style=document.createElement('style')
  style.id='profile-featured-media-css'
  style.textContent=`
  .profile-feature-grid.normalized{grid-template-columns:1.35fr 1fr 1fr}
  .profile-feature-card{position:relative;min-width:0;aspect-ratio:1}
  .profile-feature-card:first-child{aspect-ratio:1.35/1}
  .profile-feature-card .profile-feature-item{display:block;width:100%;height:100%;aspect-ratio:auto}
  .profile-feature-remove{position:absolute;right:6px;top:6px;z-index:3;width:28px;height:28px;border:0;border-radius:50%;display:grid;place-items:center;background:rgba(17,17,16,.72);color:#fff;font:700 17px/1 system-ui;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer}
  `
  document.head.appendChild(style)
}

async function resolveMemberId(detail:HTMLElement){
  if(activeMemberId)return activeMemberId
  const name=detail.querySelector<HTMLElement>('.profile-detail-top b')?.textContent?.trim()||''
  if(!name)return''
  const {data,error}=await supabase.from('family_members').select('id').eq('name',name).eq('active',true).maybeSingle()
  if(error||!data?.id)return''
  activeMemberId=String(data.id)
  return activeMemberId
}

async function loadRows(memberId:string){
  const {data,error}=await supabase.from('profile_featured_media')
    .select('member_id,slot,storage_path,source_type,source_photo_id,created_at')
    .eq('member_id',memberId)
    .order('slot')
  if(error)throw error
  return (data||[]) as FeaturedRow[]
}

function status(detail:HTMLElement,text:string){
  const node=detail.querySelector<HTMLElement>('[data-feature-status]')
  if(node)node.textContent=text
}

async function openFeatured(rows:FeaturedRow[],index:number){
  const signed=await Promise.all(rows.map(async row=>{
    const src=await signMedia(row.storage_path).catch(()=>mediaUrl(row.storage_path))
    return src?{src,alt:'Momento destacado'}:null
  }))
  const items=signed.filter((item):item is {src:string;alt:string}=>!!item)
  if(!items.length)return
  enterView('media')
  openMediaViewer(items,Math.min(index,items.length-1))
}

function stopRealtime(){
  realtimeChannel?.unsubscribe()
  realtimeChannel=null
  realtimeMemberId=''
}

function startRealtime(memberId:string,detail:HTMLElement){
  if(realtimeChannel&&realtimeMemberId===memberId)return
  stopRealtime()
  realtimeMemberId=memberId
  realtimeChannel=supabase.channel(`profile-featured-${memberId}-${Date.now()}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'profile_featured_media',filter:`member_id=eq.${memberId}`},()=>{
      if(detail.isConnected)scheduleRender(detail,20)
    })
    .subscribe()
}

async function render(detail:HTMLElement){
  if(!detail.isConnected||rendering||mutationBusy)return
  const memberId=await resolveMemberId(detail)
  if(!memberId||!detail.isConnected)return
  startRealtime(memberId,detail)
  rendering=true
  try{
    const rows=await loadRows(memberId)
    await primeMedia(rows.map(row=>row.storage_path))
    if(!detail.isConnected)return
    const mine=getIdentity()?.memberId===memberId
    const visible=rows.map(row=>({row,src:mediaUrl(row.storage_path)})).filter(item=>!!item.src)
    const visibleRows=visible.map(item=>item.row)
    const selectedIds=new Set(rows.map(row=>row.source_photo_id).filter((id):id is string=>!!id))

    detail.querySelectorAll<HTMLButtonElement>('[data-feature-photo]').forEach(star=>{
      const selected=selectedIds.has(star.dataset.featurePhoto||'')
      star.textContent=selected?'★':'☆'
      star.classList.toggle('selected',selected)
      star.setAttribute('aria-label',selected?'Quitar de destacados':'Destacar momento')
    })

    const target=detail.querySelector<HTMLElement>('[data-featured-grid]')
    if(!target)return
    target.innerHTML=visible.length
      ?`<div class="profile-feature-grid normalized">${visible.map((item,index)=>`<div class="profile-feature-card"><button type="button" class="profile-feature-item" data-normalized-feature-index="${index}" aria-label="Abrir momento destacado"><img src="${esc(item.src)}" alt="Momento destacado" loading="lazy" decoding="async"></button>${mine?`<button type="button" class="profile-feature-remove" data-remove-feature-slot="${item.row.slot}" aria-label="Quitar de destacados">×</button>`:''}</div>`).join('')}</div>`
      :(mine?'<div class="profile-feature-empty">Toca ☆ en hasta 3 fotos para destacar tus momentos favoritos.</div>':'')

    target.querySelectorAll<HTMLButtonElement>('[data-normalized-feature-index]').forEach(button=>button.addEventListener('click',()=>{
      void openFeatured(visibleRows,Number(button.dataset.normalizedFeatureIndex||0))
    }))
  }catch(error){
    console.error('Profile featured media load failed',error)
  }finally{
    rendering=false
  }
}

function scheduleRender(detail:HTMLElement,delay=0){
  if(renderTimer!==null)window.clearTimeout(renderTimer)
  renderTimer=window.setTimeout(()=>{
    renderTimer=null
    void render(detail)
  },delay)
}

injectStyles()

document.addEventListener('click',event=>{
  const profileButton=(event.target as Element|null)?.closest<HTMLElement>('[data-profile-id]')
  if(profileButton?.dataset.profileId)activeMemberId=profileButton.dataset.profileId
},true)

document.addEventListener('click',event=>{
  const target=event.target as Element|null
  const detail=target?.closest<HTMLElement>('.profile-detail')
  if(!detail)return

  const star=target.closest<HTMLButtonElement>('[data-feature-photo]')
  const remove=target.closest<HTMLButtonElement>('[data-remove-feature-slot]')
  if(!star&&!remove)return

  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  if(mutationBusy)return

  void(async()=>{
    mutationBusy=true
    status(detail,'Guardando…')
    try{
      if(star){
        const photoId=star.dataset.featurePhoto||''
        if(!photoId)return
        const {error}=await supabase.rpc('toggle_profile_featured_photo',{p_photo_id:photoId})
        if(error){
          if(String(error.message||'').includes('FEATURED_PHOTOS_LIMIT'))status(detail,'Puedes destacar un máximo de 3 momentos. Quita uno primero.')
          else throw error
        }else status(detail,'Destacados guardados ✓')
      }else if(remove){
        const slot=Number(remove.dataset.removeFeatureSlot||0)
        if(!slot)return
        const {error}=await supabase.rpc('remove_profile_featured_media',{p_slot:slot})
        if(error)throw error
        status(detail,'Destacados guardados ✓')
      }
    }catch(error){
      console.error('Profile featured media update failed',error)
      status(detail,'No se pudieron guardar los destacados.')
    }finally{
      mutationBusy=false
      scheduleRender(detail,0)
    }
  })()
},true)

const observer=new MutationObserver(mutations=>{
  let detail:HTMLElement|null=null
  for(const mutation of mutations){
    for(const node of Array.from(mutation.addedNodes)){
      if(!(node instanceof Element))continue
      detail=node.matches('.profile-detail')?node as HTMLElement:node.querySelector<HTMLElement>('.profile-detail')
      if(detail)break
    }
    if(detail)break
  }
  if(detail){scheduleRender(detail,0);return}
  if(!document.querySelector('.profile-detail')){
    activeMemberId=''
    stopRealtime()
  }
})
observer.observe(document.body,{childList:true,subtree:true})

window.addEventListener('popstate',()=>{
  if(!document.querySelector('.profile-detail')){
    activeMemberId=''
    stopRealtime()
  }
})

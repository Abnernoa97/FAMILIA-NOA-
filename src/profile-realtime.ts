import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { mediaUrl, primeMedia } from './core/private-media'

type ProfileRow={
  member_id:string
  avatar_path:string|null
  bio:string
  theme:string
  updated_at?:string
  cover_path:string|null
}

let activeDetailMemberId=''
let resolvingDetail=false

function updateAvatarContainer(root:Element,row:ProfileRow){
  const url=row.avatar_path?mediaUrl(row.avatar_path):''
  const image=root.querySelector<HTMLImageElement>('.profile-avatar')
  const fallback=root.querySelector<HTMLElement>('.profile-avatar-fallback')
  if(image){
    if(url)image.src=url
    image.style.display=url?'block':'none'
  }
  if(fallback)fallback.style.display=url?'none':''
}

function updateCover(root:Element,row:ProfileRow){
  const url=row.cover_path?mediaUrl(row.cover_path):''
  const preview=root.querySelector<HTMLElement>('#coverPreview')
  if(preview)preview.style.backgroundImage=url?`url("${url}")`:''

  const detailCover=root.querySelector<HTMLElement>('.profile-detail-cover')
  if(!detailCover)return
  if(url){
    if(detailCover instanceof HTMLImageElement){
      detailCover.src=url
    }else{
      const image=document.createElement('img')
      image.className='profile-detail-cover'
      image.src=url
      image.alt='Portada de perfil'
      detailCover.replaceWith(image)
    }
  }else if(detailCover instanceof HTMLImageElement){
    const empty=document.createElement('div')
    empty.className='profile-detail-cover'
    detailCover.replaceWith(empty)
  }
}

function updateProfileListAvatar(row:ProfileRow){
  const button=document.querySelector<HTMLElement>(`[data-profile-id="${row.member_id}"]`)
  const holder=button?.querySelector<HTMLElement>('.profile-list-avatar')
  if(!holder)return
  const url=row.avatar_path?mediaUrl(row.avatar_path):''
  const name=button?.querySelector<HTMLElement>('.profile-list-copy strong')?.textContent?.replace(' · tú','').trim()||''
  holder.innerHTML=url?`<img src="${url}" alt="Foto de ${name}">`:(name.charAt(0)||'F')
}

function applyOwnMenu(row:ProfileRow){
  const identity=getIdentity()
  const menu=document.querySelector<HTMLElement>('.profile-menu')
  if(!menu||identity?.memberId!==row.member_id)return
  updateAvatarContainer(menu,row)
  updateCover(menu,row)
  const bioPreview=menu.querySelector<HTMLElement>('#bioPreview')
  if(bioPreview)bioPreview.textContent=row.bio?.trim()||'Tu espacio dentro de FAMILIA NOA.'
  const bio=menu.querySelector<HTMLTextAreaElement>('#bio')
  if(bio&&document.activeElement!==bio){
    bio.value=row.bio||''
    const count=menu.querySelector<HTMLElement>('#bioCount')
    if(count)count.textContent=String(bio.value.length)
  }
}

function applyDetail(row:ProfileRow){
  const detail=document.querySelector<HTMLElement>('.profile-detail')
  if(!detail||activeDetailMemberId!==row.member_id)return
  updateAvatarContainer(detail,row)
  updateCover(detail,row)
  const bio=detail.querySelector<HTMLElement>('.profile-detail-bio')
  if(bio)bio.textContent=row.bio?.trim()||'Esta persona todavía no ha escrito su frase.'
}

async function applyProfile(row:ProfileRow){
  await primeMedia([row.avatar_path,row.cover_path])
  applyOwnMenu(row)
  applyDetail(row)
  updateProfileListAvatar(row)
}

async function resolveDetail(detail:HTMLElement){
  if(resolvingDetail)return
  resolvingDetail=true
  try{
    const name=detail.querySelector<HTMLElement>('.profile-detail-top b')?.textContent?.trim()||''
    if(!name)return
    const {data,error}=await supabase.from('family_members').select('id').eq('name',name).eq('active',true).maybeSingle()
    if(!error&&data?.id)activeDetailMemberId=String(data.id)
  }finally{
    resolvingDetail=false
  }
}

document.addEventListener('click',event=>{
  const profileButton=(event.target as Element|null)?.closest<HTMLElement>('[data-profile-id]')
  if(profileButton?.dataset.profileId)activeDetailMemberId=profileButton.dataset.profileId
},true)

const observer=new MutationObserver(mutations=>{
  let detailAdded:HTMLElement|null=null
  for(const mutation of mutations){
    for(const node of Array.from(mutation.addedNodes)){
      if(!(node instanceof Element))continue
      detailAdded=node.matches('.profile-detail')?node as HTMLElement:node.querySelector<HTMLElement>('.profile-detail')
      if(detailAdded)break
    }
    if(detailAdded)break
  }
  if(detailAdded)void resolveDetail(detailAdded)
  if(!document.querySelector('.profile-detail'))activeDetailMemberId=''
})
observer.observe(document.body,{childList:true,subtree:true})

supabase.channel('profile-family-realtime')
  .on('postgres_changes',{event:'*',schema:'public',table:'family_profiles'},payload=>{
    if(payload.eventType==='DELETE')return
    void applyProfile(payload.new as ProfileRow).catch(error=>console.error('Profile realtime sync failed',error))
  })
  .subscribe()

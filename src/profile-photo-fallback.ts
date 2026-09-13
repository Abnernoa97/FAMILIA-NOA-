import { supabase } from './supabase'

const PROFILE_KEY='familia-noa-profile'
const BUCKET='family-photos'
const seen=new Set<string>()
const pending=new Set<string>()
let scheduled=false

function current(){
  const raw=sessionStorage.getItem(PROFILE_KEY)
  return raw?JSON.parse(raw):null
}
function url(path:string){
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

async function latestPhoto(id:string){
  const {data}=await supabase.from('photos').select('storage_path').eq('uploader_id',id).order('created_at',{ascending:false}).limit(1)
  return data?.[0]?.storage_path||''
}

async function decorateHome(){
  const p=current()
  const button=document.querySelector<HTMLElement>('#change')
  if(!p||!button||button.querySelector('img'))return
  const key=`home:${p.id}`
  if(seen.has(key)||pending.has(key))return
  pending.add(key)
  try{
    const path=await latestPhoto(p.id)
    if(!path)return
    const currentButton=document.querySelector<HTMLElement>('#change')
    if(!currentButton||currentButton.querySelector('img'))return
    currentButton.innerHTML=`<img src="${url(path)}" alt="Foto de perfil">`
    seen.add(key)
  }finally{
    pending.delete(key)
  }
}

async function decorateDetail(detail:Element){
  const gallery=detail.querySelector<HTMLElement>('.profile-gallery')
  const avatars=detail.querySelectorAll<HTMLImageElement>('.profile-head .profile-avatar')
  const avatar=avatars[0]
  if(!gallery||!avatar||avatar.getAttribute('src'))return
  const first=gallery.querySelector<HTMLImageElement>('img')
  if(!first?.src)return
  avatar.src=first.src
  avatar.style.display='block'
  const fallback=avatars[1] as HTMLElement|null
  if(fallback)fallback.style.display='none'
}

function run(){
  if(scheduled)return
  scheduled=true
  queueMicrotask(()=>{
    scheduled=false
    void decorateHome()
    document.querySelectorAll('.profile-detail').forEach(d=>void decorateDetail(d))
  })
}

const observer=new MutationObserver(run)
observer.observe(document.body,{childList:true,subtree:true})
run()

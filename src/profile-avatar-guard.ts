import { supabase } from './supabase'
import { forgetMedia, signMedia } from './core/private-media'
import { getIdentity } from './core/identity'

let scheduled:number|null=null
let currentPathPromise:Promise<string>|null=null

function initial(){return getIdentity()?.name?.trim().charAt(0).toUpperCase()||'F'}

function fallbackHome(button:HTMLButtonElement){
  button.textContent=initial()
  button.setAttribute('aria-label','Abrir perfil')
  button.dataset.avatarFallback='1'
}

async function currentAvatarPath(){
  if(currentPathPromise)return currentPathPromise
  currentPathPromise=(async()=>{
    const identity=getIdentity()
    if(!identity?.memberId)return ''
    const {data,error}=await supabase
      .from('family_profiles')
      .select('avatar_path')
      .eq('member_id',identity.memberId)
      .maybeSingle()
    if(error)throw error
    return String(data?.avatar_path||'')
  })().finally(()=>{window.setTimeout(()=>{currentPathPromise=null},1500)})
  return currentPathPromise
}

async function recoverHomeAvatar(button:HTMLButtonElement,img:HTMLImageElement){
  if(img.dataset.avatarRecovery==='working')return
  if(img.dataset.avatarRecovery==='done'){fallbackHome(button);return}
  img.dataset.avatarRecovery='working'
  try{
    const path=await currentAvatarPath()
    if(!path){fallbackHome(button);return}
    forgetMedia(path)
    const fresh=await signMedia(path)
    if(!fresh){fallbackHome(button);return}
    img.dataset.avatarRecovery='done'
    img.alt=''
    img.src=fresh
  }catch(error){
    console.warn('Profile avatar recovery failed',error)
    fallbackHome(button)
  }finally{
    if(document.contains(img)&&img.dataset.avatarRecovery==='working')img.dataset.avatarRecovery='done'
  }
}

function bindHomeAvatar(){
  const button=document.querySelector<HTMLButtonElement>('#change')
  if(!button)return
  button.setAttribute('aria-label','Abrir perfil')
  const img=button.querySelector<HTMLImageElement>('img')
  if(!img)return
  img.alt=''
  if(img.dataset.avatarGuard==='1')return
  img.dataset.avatarGuard='1'
  img.addEventListener('error',()=>void recoverHomeAvatar(button,img))
  if(img.complete&&img.naturalWidth===0)void recoverHomeAvatar(button,img)
}

function bindOwnProfileAvatar(){
  const img=document.querySelector<HTMLImageElement>('#myAvatar')
  if(!img||img.dataset.avatarGuard==='1')return
  img.dataset.avatarGuard='1'
  img.addEventListener('error',()=>{
    img.style.display='none'
    const fallback=document.querySelector<HTMLElement>('#avatarFallback')
    if(fallback){fallback.style.display='grid';fallback.textContent=initial()}
  })
  if(img.complete&&img.naturalWidth===0)img.dispatchEvent(new Event('error'))
}

function bindProfileList(){
  document.querySelectorAll<HTMLImageElement>('.profile-list-avatar img').forEach(img=>{
    if(img.dataset.avatarGuard==='1')return
    img.dataset.avatarGuard='1'
    img.alt=''
    img.addEventListener('error',()=>{
      const host=img.closest<HTMLElement>('.profile-list-avatar')
      if(!host)return
      const name=img.closest('.profile-list-item')?.querySelector<HTMLElement>('.profile-list-copy strong')?.textContent?.replace(/\s*·\s*tú\s*$/i,'').trim()||''
      host.textContent=name.charAt(0).toUpperCase()||'•'
    })
    if(img.complete&&img.naturalWidth===0)img.dispatchEvent(new Event('error'))
  })
}

function scan(){
  scheduled=null
  bindHomeAvatar()
  bindOwnProfileAvatar()
  bindProfileList()
}

function schedule(){
  if(scheduled!==null)return
  scheduled=window.setTimeout(scan,0)
}

const observer=new MutationObserver(schedule)
observer.observe(document.body,{childList:true,subtree:true})
window.addEventListener('pageshow',schedule)
window.addEventListener('online',schedule)
window.addEventListener('familia-noa:identity-changed',()=>{currentPathPromise=null;schedule()})
schedule()

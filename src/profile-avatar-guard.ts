import { supabase } from './supabase'
import { forgetMedia, signMedia } from './core/private-media'
import { getIdentity } from './core/identity'

let scheduled:number|null=null
let currentPathPromise:Promise<string>|null=null
const memberPathPromises=new Map<string,Promise<string>>()

function initial(){return getIdentity()?.name?.trim().charAt(0).toUpperCase()||'F'}

function fallbackHome(button:HTMLButtonElement){
  button.textContent=initial()
  button.setAttribute('aria-label','Abrir perfil')
  button.dataset.avatarFallback='1'
}

async function avatarPathFor(memberId:string){
  if(!memberId)return ''
  const existing=memberPathPromises.get(memberId)
  if(existing)return existing
  const promise=(async()=>{
    const {data,error}=await supabase
      .from('family_profiles')
      .select('avatar_path')
      .eq('member_id',memberId)
      .maybeSingle()
    if(error)throw error
    return String(data?.avatar_path||'')
  })()
  memberPathPromises.set(memberId,promise)
  window.setTimeout(()=>memberPathPromises.delete(memberId),1500)
  return promise
}

async function currentAvatarPath(){
  if(currentPathPromise)return currentPathPromise
  currentPathPromise=(async()=>{
    const identity=getIdentity()
    if(!identity?.memberId)return ''
    return avatarPathFor(identity.memberId)
  })().finally(()=>{window.setTimeout(()=>{currentPathPromise=null},1500)})
  return currentPathPromise
}

async function freshAvatarUrl(path:string){
  if(!path)return ''
  // Clear both a stale signed URL and any negative-cache entry before retrying.
  // Profile photos are tiny, so a fresh signature here is cheap and avoids a
  // letter-only avatar when the private-media cache was empty during first paint.
  forgetMedia(path)
  return await signMedia(path)
}

function bindHomeImage(button:HTMLButtonElement,img:HTMLImageElement){
  img.alt=''
  if(img.dataset.avatarGuard==='1')return
  img.dataset.avatarGuard='1'
  img.addEventListener('error',()=>void recoverHomeAvatar(button,img))
  if(img.complete&&img.naturalWidth===0)void recoverHomeAvatar(button,img)
}

async function recoverHomeAvatar(button:HTMLButtonElement,img?:HTMLImageElement){
  if(button.dataset.avatarRecovery==='working')return
  if(button.dataset.avatarRecovery==='done'&&img){fallbackHome(button);return}
  button.dataset.avatarRecovery='working'
  try{
    const path=await currentAvatarPath()
    if(!path){fallbackHome(button);return}
    const fresh=await freshAvatarUrl(path)
    if(!fresh){fallbackHome(button);return}
    let target=img
    if(!target||!document.contains(target)){
      button.innerHTML=''
      target=document.createElement('img')
      target.alt=''
      button.appendChild(target)
    }
    target.dataset.avatarRecovery='done'
    target.src=fresh
    button.dataset.avatarFallback='0'
    bindHomeImage(button,target)
  }catch(error){
    console.warn('Profile avatar recovery failed',error)
    fallbackHome(button)
  }finally{
    button.dataset.avatarRecovery='done'
  }
}

function bindHomeAvatar(){
  const button=document.querySelector<HTMLButtonElement>('#change')
  if(!button)return
  button.setAttribute('aria-label','Abrir perfil')
  const img=button.querySelector<HTMLImageElement>('img')
  if(img){bindHomeImage(button,img);return}
  if(button.dataset.avatarRecovery!=='working'){
    button.dataset.avatarRecovery=''
    void recoverHomeAvatar(button)
  }
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
  if(img.complete&&img.naturalWidth===0&&img.getAttribute('src'))img.dispatchEvent(new Event('error'))
}

async function hydrateProfileListItem(item:HTMLButtonElement){
  if(item.dataset.avatarHydrating==='1')return
  const memberId=item.dataset.profileId||''
  const host=item.querySelector<HTMLElement>('.profile-list-avatar')
  if(!memberId||!host)return
  item.dataset.avatarHydrating='1'
  try{
    const path=await avatarPathFor(memberId)
    if(!path)return
    const src=await freshAvatarUrl(path)
    if(!src)return
    const img=document.createElement('img')
    img.alt=''
    img.src=src
    host.textContent=''
    host.appendChild(img)
    bindProfileListImage(item,img)
  }catch(error){
    console.warn('Family profile avatar hydration failed',error)
  }finally{
    item.dataset.avatarHydrating='0'
  }
}

function bindProfileListImage(item:HTMLButtonElement,img:HTMLImageElement){
  if(img.dataset.avatarGuard==='1')return
  img.dataset.avatarGuard='1'
  img.alt=''
  img.addEventListener('error',()=>{
    const host=img.closest<HTMLElement>('.profile-list-avatar')
    if(!host)return
    const name=item.querySelector<HTMLElement>('.profile-list-copy strong')?.textContent?.replace(/\s*·\s*tú\s*$/i,'').trim()||''
    host.textContent=name.charAt(0).toUpperCase()||'•'
    item.dataset.avatarHydrating='0'
    window.setTimeout(()=>void hydrateProfileListItem(item),250)
  },{once:true})
}

function bindProfileList(){
  document.querySelectorAll<HTMLButtonElement>('.profile-list-item[data-profile-id]').forEach(item=>{
    const img=item.querySelector<HTMLImageElement>('.profile-list-avatar img')
    if(img){
      bindProfileListImage(item,img)
      if(img.complete&&img.naturalWidth===0)img.dispatchEvent(new Event('error'))
      return
    }
    void hydrateProfileListItem(item)
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
window.addEventListener('familia-noa:identity-changed',()=>{
  currentPathPromise=null
  memberPathPromises.clear()
  schedule()
})
schedule()

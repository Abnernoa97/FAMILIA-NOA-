import './home-stories.css'
import { getIdentity } from './core/identity'

const KEY='familia-noa-home-instant-v3'
const LEGACY_KEYS=['familia-noa-home-instant-v2']
const MAX_AGE=10*60*1000
const SETTLE_MS=1500

type HomeSnapshot={
  v:3
  memberId:string
  savedAt:number
  railHtml:string
  avatarHtml:string
  unreadCount:number
}

let captureTimer:number|null=null
let restoreAt=0

try{LEGACY_KEYS.forEach(key=>localStorage.removeItem(key))}catch{}

function readSnapshot():HomeSnapshot|null{
  try{
    const raw=localStorage.getItem(KEY)
    if(!raw)return null
    const value=JSON.parse(raw) as Partial<HomeSnapshot>
    if(value.v!==3||!value.memberId||!Number.isFinite(value.savedAt))return null
    if(Date.now()-Number(value.savedAt)>MAX_AGE){localStorage.removeItem(KEY);return null}
    return {...value,unreadCount:Math.max(0,Number(value.unreadCount)||0)} as HomeSnapshot
  }catch{return null}
}

function writeSnapshot(snapshot:HomeSnapshot){
  try{localStorage.setItem(KEY,JSON.stringify(snapshot))}catch{}
}

function paintUnread(shell:HTMLElement,count:number){
  shell.querySelectorAll('.chat-unread-badge').forEach(node=>node.remove())
  if(count<=0)return
  const text=count>99?'99+':String(count)
  shell.querySelector('#chat b')?.insertAdjacentHTML('beforeend',`<span class="chat-unread-badge">${text}</span>`)
  shell.querySelector('#navchat')?.insertAdjacentHTML('beforeend',`<span class="chat-unread-badge">${text}</span>`)
}

function domUnread(shell:HTMLElement){
  const text=shell.querySelector<HTMLElement>('.chat-unread-badge')?.textContent?.trim()||''
  if(!text)return 0
  if(text==='99+')return 100
  const count=Number(text)
  return Number.isFinite(count)&&count>0?count:0
}

function restore(){
  const identity=getIdentity()
  const shell=document.querySelector<HTMLElement>('.shell')
  const top=shell?.querySelector<HTMLElement>('.top')
  if(!identity||!shell||!top)return
  const snapshot=readSnapshot()
  if(!snapshot||snapshot.memberId!==identity.memberId)return

  if(!restoreAt)restoreAt=Date.now()

  const avatar=shell.querySelector<HTMLButtonElement>('#change')
  // A snapshot is allowed to improve the initial letter into a cached image,
  // but it must never overwrite an image that has already been hydrated by
  // the live private-avatar loader. The previous behavior caused a race where
  // every avatar <img> mutation was immediately replaced again by the cached
  // single-letter markup.
  if(
    avatar&&
    snapshot.avatarHtml&&
    !avatar.querySelector('img')&&
    avatar.innerHTML!==snapshot.avatarHtml
  ){
    avatar.innerHTML=snapshot.avatarHtml
  }

  if(snapshot.unreadCount>0&&!shell.querySelector('.chat-unread-badge')){
    paintUnread(shell,snapshot.unreadCount)
  }

  if(snapshot.railHtml&&!shell.querySelector('.family-story-home')){
    const holder=document.createElement('div')
    holder.innerHTML=snapshot.railHtml
    const rail=holder.firstElementChild as HTMLElement|null
    if(rail?.classList.contains('family-story-home')){
      rail.dataset.instantSnapshot='1'
      top.insertAdjacentElement('afterend',rail)
      shell.classList.add('has-home-stories')
    }
  }
}

function capture(){
  captureTimer=null
  const identity=getIdentity()
  const shell=document.querySelector<HTMLElement>('.shell')
  if(!identity||!shell)return

  const liveRail=shell.querySelector<HTMLElement>('.family-story-home:not([data-instant-snapshot])')
  const avatar=shell.querySelector<HTMLButtonElement>('#change')
  const previous=readSnapshot()
  const settling=restoreAt>0&&Date.now()-restoreAt<SETTLE_MS
  let avatarHtml=avatar?.innerHTML||''
  let unreadCount=domUnread(shell)

  // Keep useful warm data while the first fresh requests are still settling.
  if(
    avatar&&
    !avatar.querySelector('img')&&
    previous?.memberId===identity.memberId&&
    /<img\b/i.test(previous.avatarHtml||'')&&
    settling
  ){
    avatarHtml=previous.avatarHtml
  }
  if(
    unreadCount===0&&
    previous?.memberId===identity.memberId&&
    previous.unreadCount>0&&
    settling
  ){
    unreadCount=previous.unreadCount
  }

  const railHtml=liveRail?.outerHTML||(
    previous?.memberId===identity.memberId ? previous.railHtml||'' : ''
  )
  if(!railHtml&&!avatarHtml&&!unreadCount)return

  writeSnapshot({
    v:3,
    memberId:identity.memberId,
    savedAt:Date.now(),
    railHtml,
    avatarHtml,
    unreadCount
  })
}

function scheduleCapture(delay=120){
  if(captureTimer!==null)window.clearTimeout(captureTimer)
  captureTimer=window.setTimeout(capture,delay)
}

function mutationMatters(mutation:MutationRecord){
  const target=mutation.target
  if(target instanceof Element&&target.closest('.family-story-home,#change,#chat,#navchat'))return true
  return Array.from(mutation.addedNodes).some(node=>{
    if(!(node instanceof Element))return false
    return node.matches('.shell,.family-story-home,#change,.chat-unread-badge')||!!node.querySelector('.family-story-home,#change,.chat-unread-badge')
  })
}

// Cached story rail nodes look interactive, but their HTML cannot preserve
// event listeners across a WebView restart. Forward the tap straight to the
// canonical story controller and keep the rail stable while it hydrates.
document.addEventListener('click',event=>{
  const target=event.target as Element|null
  const cached=target?.closest<HTMLElement>('.family-story-home[data-instant-snapshot="1"]')
  if(!cached)return
  const create=target?.closest<HTMLElement>('[data-home-story-create]')
  const member=target?.closest<HTMLElement>('[data-home-story-member]')
  if(!create&&!member)return
  event.preventDefault()
  event.stopImmediatePropagation()
  window.dispatchEvent(new CustomEvent('familia-noa:snapshot-story-press',{
    detail:create?{kind:'create'}:{kind:'member',memberId:member?.dataset.homeStoryMember||''}
  }))
},true)

const observer=new MutationObserver(mutations=>{
  if(mutations.some(mutationMatters)){
    restore()
    scheduleCapture()
  }
})
observer.observe(document.body,{childList:true,subtree:true})

window.addEventListener('familia-noa:identity-changed',()=>{
  restoreAt=0
  restore()
  scheduleCapture(300)
})
window.addEventListener('pageshow',()=>restore())
window.addEventListener('beforeunload',()=>{
  observer.disconnect()
  if(captureTimer!==null)window.clearTimeout(captureTimer)
  capture()
},{once:true})

restore()
window.setTimeout(capture,SETTLE_MS+200)

import './home-stories.css'
import { getIdentity } from './core/identity'

const KEY='familia-noa-home-instant-v1'
const MAX_AGE=10*60*1000
const AVATAR_SETTLE_MS=1500

type HomeSnapshot={
  v:1
  memberId:string
  savedAt:number
  railHtml:string
  avatarHtml:string
}

let captureTimer:number|null=null
let restoreAt=0
let queuedAction:{kind:'member'|'create';memberId?:string}|null=null
let actionTimer:number|null=null

function readSnapshot():HomeSnapshot|null{
  try{
    const raw=localStorage.getItem(KEY)
    if(!raw)return null
    const value=JSON.parse(raw) as Partial<HomeSnapshot>
    if(value.v!==1||!value.memberId||!Number.isFinite(value.savedAt))return null
    if(Date.now()-Number(value.savedAt)>MAX_AGE){localStorage.removeItem(KEY);return null}
    return value as HomeSnapshot
  }catch{return null}
}

function writeSnapshot(snapshot:HomeSnapshot){
  try{localStorage.setItem(KEY,JSON.stringify(snapshot))}catch{}
}

function restore(){
  const identity=getIdentity()
  const shell=document.querySelector<HTMLElement>('.shell')
  const top=shell?.querySelector<HTMLElement>('.top')
  if(!identity||!shell||!top)return
  const snapshot=readSnapshot()
  if(!snapshot||snapshot.memberId!==identity.memberId)return

  const avatar=shell.querySelector<HTMLButtonElement>('#change')
  if(avatar&&snapshot.avatarHtml&&avatar.innerHTML!==snapshot.avatarHtml){
    avatar.innerHTML=snapshot.avatarHtml
  }

  if(snapshot.railHtml&&!shell.querySelector('.family-story-home')){
    const holder=document.createElement('div')
    holder.innerHTML=snapshot.railHtml
    const rail=holder.firstElementChild as HTMLElement|null
    if(rail?.classList.contains('family-story-home')){
      rail.dataset.instantSnapshot='1'
      top.insertAdjacentElement('afterend',rail)
      shell.classList.add('has-home-stories')
      restoreAt=Date.now()
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
  let avatarHtml=avatar?.innerHTML||''

  // Do not let the initial one-letter placeholder overwrite a useful cached avatar
  // while the fresh profile request is still settling.
  if(
    avatar&&
    !avatar.querySelector('img')&&
    previous?.memberId===identity.memberId&&
    /<img\b/i.test(previous.avatarHtml||'')&&
    restoreAt>0&&Date.now()-restoreAt<AVATAR_SETTLE_MS
  ){
    avatarHtml=previous.avatarHtml
  }

  const railHtml=liveRail?.outerHTML||(
    previous?.memberId===identity.memberId ? previous.railHtml||'' : ''
  )
  if(!railHtml&&!avatarHtml)return

  writeSnapshot({
    v:1,
    memberId:identity.memberId,
    savedAt:Date.now(),
    railHtml,
    avatarHtml
  })
}

function scheduleCapture(delay=120){
  if(captureTimer!==null)window.clearTimeout(captureTimer)
  captureTimer=window.setTimeout(capture,delay)
}

function mutationMatters(mutation:MutationRecord){
  const target=mutation.target
  if(target instanceof Element&&target.closest('.family-story-home,#change'))return true
  return Array.from(mutation.addedNodes).some(node=>{
    if(!(node instanceof Element))return false
    return node.matches('.shell,.family-story-home,#change')||!!node.querySelector('.family-story-home,#change')
  })
}

function replayQueuedAction(){
  if(!queuedAction)return
  const live=document.querySelector<HTMLElement>('.family-story-home:not([data-instant-snapshot])')
  if(!live)return
  const action=queuedAction
  queuedAction=null
  if(actionTimer!==null){window.clearTimeout(actionTimer);actionTimer=null}
  if(action.kind==='create'){
    live.querySelector<HTMLElement>('[data-home-story-create]')?.click()
    return
  }
  if(action.memberId){
    live.querySelector<HTMLElement>(`[data-home-story-member="${CSS.escape(action.memberId)}"]`)?.click()
  }
}

function queueAction(action:{kind:'member'|'create';memberId?:string}){
  queuedAction=action
  replayQueuedAction()
  if(!queuedAction)return
  if(actionTimer!==null)window.clearTimeout(actionTimer)
  const started=Date.now()
  const tryAgain=()=>{
    replayQueuedAction()
    if(!queuedAction||Date.now()-started>3000){queuedAction=null;actionTimer=null;return}
    actionTimer=window.setTimeout(tryAgain,60)
  }
  actionTimer=window.setTimeout(tryAgain,30)
}

document.addEventListener('click',event=>{
  const target=event.target as Element|null
  const cached=target?.closest<HTMLElement>('.family-story-home[data-instant-snapshot="1"]')
  if(!cached)return
  const create=target?.closest<HTMLElement>('[data-home-story-create]')
  const member=target?.closest<HTMLElement>('[data-home-story-member]')
  if(!create&&!member)return
  event.preventDefault()
  event.stopImmediatePropagation()
  if(create)queueAction({kind:'create'})
  else queueAction({kind:'member',memberId:member?.dataset.homeStoryMember||''})
},true)

const observer=new MutationObserver(mutations=>{
  if(mutations.some(mutationMatters)){
    restore()
    replayQueuedAction()
    scheduleCapture()
  }
})
observer.observe(document.body,{childList:true,subtree:true})

window.addEventListener('familia-noa:identity-changed',()=>{
  restoreAt=0
  queuedAction=null
  restore()
  scheduleCapture(300)
})
window.addEventListener('pageshow',()=>restore())
window.addEventListener('beforeunload',()=>{
  observer.disconnect()
  if(captureTimer!==null)window.clearTimeout(captureTimer)
  if(actionTimer!==null)window.clearTimeout(actionTimer)
  capture()
},{once:true})

restore()
window.setTimeout(capture,AVATAR_SETTLE_MS+200)

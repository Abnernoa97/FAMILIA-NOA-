import { getIdentity } from './core/identity'

type Kind='photos'|'chat'|'location'|'presume'
type Snapshot={id:string;kind:Kind;memberId:string;savedAt:number;html:string}

const DB_NAME='familia-noa-fast-views'
const STORE='snapshots'
const DB_VERSION=1
const MAX_AGE=10*60*1000
const MAX_HTML=900_000
const STALE='data-view-cache'
const memory=new Map<string,Snapshot>()
let dbPromise:Promise<IDBDatabase|null>|null=null
let captureTimer:number|null=null

function currentMemberId(){return getIdentity()?.memberId||''}
function snapshotId(kind:Kind,memberId:string){return `${kind}:${memberId}`}
function isFresh(value:Snapshot){return Date.now()-value.savedAt<=MAX_AGE}

function openDb(){
  if(dbPromise)return dbPromise
  dbPromise=new Promise(resolve=>{
    try{
      const request=indexedDB.open(DB_NAME,DB_VERSION)
      request.onupgradeneeded=()=>{
        const db=request.result
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'})
      }
      request.onsuccess=()=>resolve(request.result)
      request.onerror=()=>resolve(null)
    }catch{resolve(null)}
  })
  return dbPromise
}

function read(kind:Kind){
  const memberId=currentMemberId()
  if(!memberId)return null
  const id=snapshotId(kind,memberId)
  const value=memory.get(id)||null
  if(!value)return null
  if(!isFresh(value)){memory.delete(id);void removePersistent(id);return null}
  return value
}

async function hydrate(){
  const memberId=currentMemberId()
  if(!memberId)return
  const db=await openDb()
  if(!db)return
  await new Promise<void>(resolve=>{
    try{
      const request=db.transaction(STORE,'readonly').objectStore(STORE).getAll()
      request.onsuccess=()=>{
        const rows=(request.result||[]) as Snapshot[]
        rows.forEach(row=>{
          if(row.memberId===memberId&&isFresh(row)&&row.html)memory.set(row.id,row)
          else if(!isFresh(row))void removePersistent(row.id)
        })
        resolve()
      }
      request.onerror=()=>resolve()
    }catch{resolve()}
  })
  restoreAll()
}

function write(kind:Kind,html:string){
  const memberId=currentMemberId()
  if(!memberId||!html||html.length>MAX_HTML)return
  const value:Snapshot={id:snapshotId(kind,memberId),kind,memberId,savedAt:Date.now(),html}
  memory.set(value.id,value)
  void(async()=>{
    const db=await openDb();if(!db)return
    try{db.transaction(STORE,'readwrite').objectStore(STORE).put(value)}catch{}
  })()
}

async function removePersistent(id:string){
  const db=await openDb();if(!db)return
  try{db.transaction(STORE,'readwrite').objectStore(STORE).delete(id)}catch{}
}

async function clearPersistent(){
  memory.clear()
  const db=await openDb();if(!db)return
  try{db.transaction(STORE,'readwrite').objectStore(STORE).clear()}catch{}
}

function marker(kind:Kind){return `<i ${STALE}="${kind}" hidden></i>`}
function hasMarker(root:ParentNode,kind:Kind){return !!root.querySelector(`[${STALE}="${kind}"]`)}

function matchAlbumLayout(root:HTMLElement){
  // Paint the cached album with the same final geometry before albums-enhancer
  // refreshes it. This prevents Android from showing a one-frame scale/zoom jump.
  root.style.minHeight='100dvh'
  root.style.maxWidth='760px'
  root.style.margin='0 auto'
  root.style.display='block'
  root.style.background='#f5f2eb'
  root.style.padding='22px 18px 110px'
  if(window.matchMedia('(max-width:430px)').matches){
    root.style.paddingLeft='14px'
    root.style.paddingRight='14px'
  }
}

function restorePhotos(){
  const root=document.querySelector<HTMLElement>('[data-photo-page]')
  if(!root||hasMarker(root,'photos')||!root.querySelector('.loading'))return
  const snapshot=read('photos')
  if(!snapshot)return
  matchAlbumLayout(root)
  root.className='page photo-page instant-photo-snapshot'
  root.innerHTML=marker('photos')+snapshot.html
}

function restoreChat(){
  const list=document.querySelector<HTMLElement>('.chat-page #messages')
  if(!list||hasMarker(list,'chat')||!list.querySelector('.chat-loading'))return
  const snapshot=read('chat')
  if(!snapshot)return
  list.innerHTML=marker('chat')+snapshot.html
  list.classList.add('is-ready','instant-chat-snapshot')
  requestAnimationFrame(()=>{if(document.contains(list))list.scrollTop=Math.max(0,list.scrollHeight-list.clientHeight)})
}

function restoreLocation(){
  const list=document.querySelector<HTMLElement>('.location-page #familylocations')
  if(!list||hasMarker(list,'location')||!list.querySelector('.loading'))return
  const snapshot=read('location')
  if(!snapshot)return
  list.innerHTML=marker('location')+snapshot.html
}

function restorePresume(){
  const screen=document.querySelector<HTMLElement>('.presume-screen')
  if(!screen||hasMarker(screen,'presume')||!screen.textContent?.includes('Preparando PRESUME'))return
  const snapshot=read('presume')
  if(!snapshot)return
  screen.innerHTML=marker('presume')+snapshot.html
  screen.classList.add('instant-presume-snapshot')
}

function restoreAll(){restorePhotos();restoreChat();restoreLocation();restorePresume()}

function capturePhotos(){
  const root=document.querySelector<HTMLElement>('[data-photo-page].albums-page')
  if(!root||hasMarker(root,'photos')||!root.querySelector('.album-grid')||root.querySelector('.loading'))return
  write('photos',root.innerHTML)
}

function captureChat(){
  const list=document.querySelector<HTMLElement>('.chat-page #messages.is-ready')
  if(!list||hasMarker(list,'chat')||list.querySelector('.chat-loading'))return
  const clone=list.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.chat-pending,[data-pending-id],[data-pending-text-id]').forEach(node=>node.remove())
  clone.querySelectorAll('.reactions-open').forEach(node=>node.classList.remove('reactions-open'))
  clone.querySelectorAll(`[${STALE}]`).forEach(node=>node.remove())
  if(!clone.querySelector('.chat-bubble,.chat-empty'))return
  write('chat',clone.innerHTML)
}

function captureLocation(){
  const list=document.querySelector<HTMLElement>('.location-page #familylocations')
  if(!list||hasMarker(list,'location')||list.querySelector('.loading')||!list.querySelector('.location-section-title'))return
  const clone=list.cloneNode(true) as HTMLElement
  clone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor=>{
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.removeAttribute('rel')
    anchor.setAttribute('aria-disabled','true')
  })
  clone.querySelectorAll(`[${STALE}]`).forEach(node=>node.remove())
  write('location',clone.innerHTML)
}

function capturePresume(){
  const screen=document.querySelector<HTMLElement>('.presume-screen')
  if(!screen||hasMarker(screen,'presume')||screen.textContent?.includes('Preparando PRESUME')||screen.textContent?.includes('No pudimos abrir PRESUME'))return
  const inner=screen.querySelector<HTMLElement>('.presume-inner')
  if(!inner||!inner.querySelector('.presume-head'))return
  const clone=inner.cloneNode(true) as HTMLElement
  clone.querySelectorAll(`[${STALE}]`).forEach(node=>node.remove())
  write('presume',clone.outerHTML)
}

function captureAll(){captureTimer=null;capturePhotos();captureChat();captureLocation();capturePresume()}
function scheduleCapture(delay=160){
  if(captureTimer!==null)window.clearTimeout(captureTimer)
  captureTimer=window.setTimeout(captureAll,delay)
}

const observer=new MutationObserver(()=>{
  restoreAll()
  scheduleCapture()
})
observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']})

document.addEventListener('presume:rendered',()=>scheduleCapture(20))
document.addEventListener('click',event=>{
  const target=event.target as Element|null
  const screen=target?.closest<HTMLElement>('.presume-screen')
  if(!screen||!hasMarker(screen,'presume'))return
  event.preventDefault()
  event.stopImmediatePropagation()
  if(target?.closest('.presume-back'))history.back()
},true)

window.addEventListener('familia-noa:identity-changed',()=>{
  if(!getIdentity()){void clearPersistent();return}
  void hydrate()
  restoreAll()
})
window.addEventListener('pageshow',()=>{restoreAll();void hydrate()})
window.addEventListener('beforeunload',()=>{
  observer.disconnect()
  if(captureTimer!==null)window.clearTimeout(captureTimer)
  captureAll()
},{once:true})

restoreAll()
void hydrate()

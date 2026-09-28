import { getIdentity } from './core/identity'

const MAX_AGE=10*60*1000
const PREFIX='familia-noa-view-cache-v1'

type Kind='photos'|'chat'|'location'|'presume'
type Snapshot={memberId:string;savedAt:number;html:string}

function memberId(){return getIdentity()?.memberId||''}
function key(kind:Kind,id:string){return `${PREFIX}:${kind}:${id}`}

function read(kind:Kind):Snapshot|null{
  const id=memberId()
  if(!id)return null
  try{
    const raw=sessionStorage.getItem(key(kind,id))
    if(!raw)return null
    const value=JSON.parse(raw) as Snapshot
    if(value.memberId!==id||Date.now()-value.savedAt>MAX_AGE){sessionStorage.removeItem(key(kind,id));return null}
    return value
  }catch{return null}
}

function write(kind:Kind,html:string){
  const id=memberId()
  if(!id||!html)return
  try{sessionStorage.setItem(key(kind,id),JSON.stringify({memberId:id,savedAt:Date.now(),html}))}catch{}
}

function restorePhotos(){
  const root=document.querySelector<HTMLElement>('[data-photo-page]')
  if(!root||!root.querySelector('.loading')||root.querySelector('[data-view-cache]'))return
  const snapshot=read('photos')
  if(!snapshot)return
  root.innerHTML=`<i data-view-cache="photos" hidden></i>${snapshot.html}`
}

function capturePhotos(){
  const root=document.querySelector<HTMLElement>('[data-photo-page].albums-page')
  if(!root||root.querySelector('[data-view-cache]')||!root.querySelector('.album-grid'))return
  write('photos',root.innerHTML)
}

function scan(){restorePhotos();capturePhotos()}
const observer=new MutationObserver(scan)
observer.observe(document.body,{childList:true,subtree:true})
scan()

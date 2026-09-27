import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { forgetMedia } from './core/private-media'

let ownIds=new Set<string>()
let refreshTimer:number|null=null
let channel:ReturnType<typeof supabase.channel>|null=null

const style=document.createElement('style')
style.textContent=`
.pres-delete{margin-left:auto;border:0;background:transparent;color:#a49e95;font:700 18px/1 system-ui;padding:7px 8px;border-radius:50%;cursor:pointer}
.pres-delete:active{background:#f1ece5}.pres-delete[disabled]{opacity:.45}
`
document.head.appendChild(style)

async function loadOwnIds(){
  const me=getIdentity()?.memberId
  if(!me){ownIds.clear();return}
  const {data,error}=await supabase.from('social_posts').select('id').eq('member_id',me)
  if(error){console.error('PRESUME own posts load failed',error);return}
  ownIds=new Set((data||[]).map((row:any)=>String(row.id)))
}

function decorate(){
  document.querySelectorAll<HTMLElement>('.presume-screen .pres-post[data-post]').forEach(article=>{
    const id=article.dataset.post||''
    const head=article.querySelector<HTMLElement>('.pres-post-head')
    if(!head||!ownIds.has(id)||head.querySelector('[data-delete-post]'))return
    const button=document.createElement('button')
    button.type='button'
    button.className='pres-delete'
    button.dataset.deletePost=id
    button.setAttribute('aria-label','Eliminar momento')
    button.textContent='⋯'
    const slot=head.querySelector('.pres-post-slot')
    if(slot)head.insertBefore(button,slot)
    else head.appendChild(button)
  })
}

function scheduleRefresh(){
  if(refreshTimer)clearTimeout(refreshTimer)
  refreshTimer=window.setTimeout(async()=>{refreshTimer=null;await loadOwnIds();decorate()},120)
}

async function deletePost(postId:string,button:HTMLButtonElement){
  const me=getIdentity()?.memberId
  if(!me||!ownIds.has(postId))return
  if(!window.confirm('¿Eliminar este momento de PRESUME?'))return
  button.disabled=true

  try{
    const {data,error}=await supabase.functions.invoke('delete-presume-post',{body:{post_id:postId}})
    if(error||data?.error)throw error||new Error(String(data?.error||'PRESUME_DELETE_FAILED'))
    const paths=Array.isArray(data?.deleted_paths)?data.deleted_paths.filter((path:unknown):path is string=>typeof path==='string'):[]
    paths.forEach(forgetMedia)
    ownIds.delete(postId)
    document.querySelector<HTMLElement>(`.pres-post[data-post="${CSS.escape(postId)}"]`)?.remove()
  }catch(error){
    button.disabled=false
    console.error('PRESUME delete failed',error)
  }
}

document.addEventListener('click',event=>{
  const button=(event.target as Element|null)?.closest<HTMLButtonElement>('[data-delete-post]')
  if(!button)return
  event.preventDefault();event.stopPropagation()
  const postId=button.dataset.deletePost||''
  void deletePost(postId,button)
})

document.addEventListener('presume:rendered',scheduleRefresh)

void loadOwnIds().then(decorate)
const me=getIdentity()?.memberId
if(me){
  channel=supabase.channel(`presume-own-management-${me}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'social_posts',filter:`member_id=eq.${me}`},scheduleRefresh)
    .subscribe()
}

window.addEventListener('beforeunload',()=>{channel?.unsubscribe();if(refreshTimer)clearTimeout(refreshTimer)},{once:true})

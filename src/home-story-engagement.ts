import { supabase } from './supabase'

type ActiveStory={id:string;member_id:string}
type ResponseRow={story_id:string;kind:'heart'|'text'|'audio'}

const QUERY_CHUNK=100
let countsByMember=new Map<string,number>()
let channel:ReturnType<typeof supabase.channel>|null=null
let refreshTimer:number|null=null
let loading=false
let rerun=false
let paintQueued=false

function badgeLabel(count:number){return count>99?'99+':String(count)}

function paint(){
  document.querySelectorAll<HTMLButtonElement>('.family-story-main[data-home-story-member]').forEach(button=>{
    const memberId=button.dataset.homeStoryMember||''
    const count=countsByMember.get(memberId)||0
    const existing=button.querySelector<HTMLElement>('[data-story-response-count]')
    if(!count){existing?.remove();return}
    const label=badgeLabel(count)
    if(existing){
      if(existing.textContent!==label)existing.textContent=label
      existing.setAttribute('aria-label',`${count} ${count===1?'respuesta':'respuestas'}`)
      return
    }
    const badge=document.createElement('span')
    badge.className='family-story-response-count'
    badge.dataset.storyResponseCount='1'
    badge.textContent=label
    badge.setAttribute('aria-label',`${count} ${count===1?'respuesta':'respuestas'}`)
    button.appendChild(badge)
  })
}

function queuePaint(){
  if(paintQueued)return
  paintQueued=true
  queueMicrotask(()=>{paintQueued=false;paint()})
}

async function loadCounts(){
  if(loading){rerun=true;return}
  loading=true
  try{
    const {data:storyData,error:storyError}=await supabase
      .from('family_stories')
      .select('id,member_id')
      .gt('expires_at',new Date().toISOString())
    if(storyError)throw storyError
    const active=(storyData||[]) as ActiveStory[]
    if(!active.length){countsByMember.clear();paint();return}

    const storyMember=new Map(active.map(story=>[story.id,story.member_id]))
    const ids=active.map(story=>story.id)
    const rows:ResponseRow[]=[]
    for(let i=0;i<ids.length;i+=QUERY_CHUNK){
      const chunk=ids.slice(i,i+QUERY_CHUNK)
      const {data,error}=await supabase
        .from('family_story_responses')
        .select('story_id,kind')
        .in('story_id',chunk)
        .neq('kind','heart')
      if(error)throw error
      rows.push(...((data||[]) as ResponseRow[]))
    }

    const next=new Map<string,number>()
    rows.forEach(row=>{
      const memberId=storyMember.get(row.story_id)
      if(!memberId)return
      next.set(memberId,(next.get(memberId)||0)+1)
    })
    countsByMember=next
    paint()
  }catch(error){
    console.error('Story engagement counts failed to load',error)
  }finally{
    loading=false
    if(rerun){rerun=false;void loadCounts()}
  }
}

function scheduleRefresh(){
  if(refreshTimer!==null)window.clearTimeout(refreshTimer)
  refreshTimer=window.setTimeout(()=>{refreshTimer=null;void loadCounts()},90)
}

function startRealtime(){
  if(channel)return
  channel=supabase.channel('familia-story-engagement-counts')
    .on('postgres_changes',{event:'*',schema:'public',table:'family_story_responses'},scheduleRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'family_stories'},scheduleRefresh)
    .subscribe()
}

const observer=new MutationObserver(mutations=>{
  const railAdded=mutations.some(mutation=>Array.from(mutation.addedNodes).some(node=>{
    if(!(node instanceof Element))return false
    return node.matches('.family-story-home')||!!node.querySelector('.family-story-home')
  }))
  if(railAdded)queuePaint()
})
observer.observe(document.body,{childList:true,subtree:true})

window.addEventListener('familia-noa:identity-changed',()=>{
  countsByMember.clear()
  queuePaint()
  scheduleRefresh()
})
window.addEventListener('beforeunload',()=>{
  observer.disconnect()
  channel?.unsubscribe()
  channel=null
},{once:true})

startRealtime()
void loadCounts()
queuePaint()

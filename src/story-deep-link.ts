import { supabase } from './supabase'

type StoryRow={id:string;member_id:string;media_path:string;created_at:string;expires_at:string}

let running=false

function targetStoryId(){
  try{return new URL(location.href).searchParams.get('story')||''}catch{return''}
}

function cleanQuery(){
  try{
    const url=new URL(location.href)
    url.searchParams.delete('story')
    url.searchParams.delete('response')
    history.replaceState(history.state,'',url.pathname+url.search+url.hash)
  }catch{}
}

function signedPath(src:string){
  if(!src)return''
  try{
    const url=new URL(src,location.href)
    const marker='/storage/v1/object/sign/family-photos/'
    const index=url.pathname.indexOf(marker)
    if(index<0)return''
    return decodeURIComponent(url.pathname.slice(index+marker.length))
  }catch{return''}
}

async function waitFor<T>(read:()=>T|null,timeout=9000,step=80):Promise<T|null>{
  const started=Date.now()
  while(Date.now()-started<timeout){
    const value=read()
    if(value)return value
    await new Promise(resolve=>window.setTimeout(resolve,step))
  }
  return null
}

async function waitForPathChange(previous:string,timeout=2500){
  return waitFor(()=>{
    const image=document.querySelector<HTMLImageElement>('.family-story-viewer .family-story-stage > img')
    const path=signedPath(image?.src||'')
    return path&&path!==previous?path:null
  },timeout,50)
}

async function openFromQuery(){
  const storyId=targetStoryId()
  if(!storyId||running)return
  running=true
  try{
    const now=new Date().toISOString()
    const {data:story,error}=await supabase
      .from('family_stories')
      .select('id,member_id,media_path,created_at,expires_at')
      .eq('id',storyId)
      .gt('expires_at',now)
      .maybeSingle()
    if(error)throw error
    if(!story){cleanQuery();return}
    const target=story as StoryRow

    const tile=await waitFor(()=>{
      const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-home-story-member]'))
      return buttons.find(button=>button.dataset.homeStoryMember===target.member_id)||null
    },12000,100)
    if(!tile)return

    tile.click()
    const viewer=await waitFor(()=>document.querySelector<HTMLElement>('.family-story-viewer'),6000,60)
    if(!viewer)return

    const {data:list,error:listError}=await supabase
      .from('family_stories')
      .select('id,member_id,media_path,created_at,expires_at')
      .eq('member_id',target.member_id)
      .gt('expires_at',now)
      .order('created_at',{ascending:true})
    if(listError)throw listError
    const rows=(list||[]) as StoryRow[]
    const targetIndex=rows.findIndex(item=>item.id===storyId)
    if(targetIndex<0){cleanQuery();return}

    for(let attempt=0;attempt<rows.length+2;attempt++){
      const image=await waitFor(()=>document.querySelector<HTMLImageElement>('.family-story-viewer .family-story-stage > img'),2500,50)
      if(!image)break
      const currentPath=signedPath(image.src)
      if(currentPath===target.media_path){cleanQuery();return}
      const currentIndex=rows.findIndex(item=>item.media_path===currentPath)
      if(currentIndex<0)break
      const selector=currentIndex<targetIndex?'[data-story-next]':'[data-story-prev]'
      const button=document.querySelector<HTMLButtonElement>(`.family-story-viewer ${selector}`)
      if(!button)break
      button.click()
      await waitForPathChange(currentPath)
    }
    cleanQuery()
  }catch(error){
    console.error('Story deep link failed',error)
  }finally{
    running=false
  }
}

window.addEventListener('focus',()=>void openFromQuery())
window.addEventListener('pageshow',()=>void openFromQuery())
window.addEventListener('familia-noa:identity-changed',()=>window.setTimeout(()=>void openFromQuery(),0))
window.setTimeout(()=>void openFromQuery(),0)

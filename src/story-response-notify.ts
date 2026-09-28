import { supabase } from './supabase'
import { getIdentity } from './core/identity'

type StoryResponseInsert={id:string;member_id:string}

const announced=new Set<string>()
let channel:ReturnType<typeof supabase.channel>|null=null

async function announce(row:StoryResponseInsert){
  const memberId=getIdentity()?.memberId||''
  if(!memberId||row.member_id!==memberId||announced.has(row.id))return
  announced.add(row.id)
  try{
    const {error}=await supabase.functions.invoke('story-response-push',{body:{response_id:row.id}})
    if(error)throw error
  }catch(error){
    announced.delete(row.id)
    console.error('Story response push failed',error)
  }
}

function start(){
  if(channel)return
  channel=supabase.channel('familia-story-response-push')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'family_story_responses'},payload=>{
      const row=payload.new as StoryResponseInsert
      void announce(row)
    })
    .subscribe()
}

start()

window.addEventListener('beforeunload',()=>{
  channel?.unsubscribe()
  channel=null
},{once:true})

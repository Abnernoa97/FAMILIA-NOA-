import { supabase } from './supabase'
import { getIdentity } from './core/identity'

const HEARTBEAT_MS=5*60*1000
let timer:number|null=null
let busy=false

async function ping(){
  if(busy||document.hidden)return
  const identity=getIdentity()
  if(!identity?.memberId)return
  busy=true
  try{
    const now=new Date().toISOString()
    const {error}=await supabase.from('family_presence').upsert({member_id:identity.memberId,last_seen_at:now,updated_at:now})
    if(error)console.warn('Family presence update failed',error)
  }catch(error){
    console.warn('Family presence update failed',error)
  }finally{busy=false}
}

function start(){
  if(timer!==null)return
  void ping()
  timer=window.setInterval(()=>void ping(),HEARTBEAT_MS)
}

function stop(){if(timer!==null){window.clearInterval(timer);timer=null}}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden)stop()
  else start()
})
window.addEventListener('focus',()=>void ping())
window.addEventListener('beforeunload',stop,{once:true})
start()

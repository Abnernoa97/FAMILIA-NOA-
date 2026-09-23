import { supabase } from './supabase'

const actionIcons={
  camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6.5 9.4 4h5.2L16 6.5h2.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V9a2.5 2.5 0 0 1 2.5-2.5H8Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  video:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10 5-2.5v9L16 14"/></svg>',
  text:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v12M8.5 18h7"/></svg>',
  voice:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></svg>'
} as const

let statsTimer:number|null=null
let statsLoading=false
let statsQueued=false

function localDateKey(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function decorateQuickActions(root:HTMLElement){
  const compose=root.querySelector<HTMLElement>('.pres-compose')
  if(!compose)return
  const specs=[
    ['[data-camera]','camera','Foto'],
    ['[data-video]','video','Video'],
    ['[data-text]','text','Texto'],
    ['[data-voice]','voice','Voz']
  ] as const

  specs.forEach(([selector,key,label])=>{
    const button=compose.querySelector<HTMLButtonElement>(selector)
    if(!button||button.dataset.editorial==='1')return
    button.dataset.editorial='1'
    button.innerHTML=`<i aria-hidden="true">${actionIcons[key]}</i><span>${label}</span>`
  })
}

async function syncChallengeStats(){
  const root=document.querySelector<HTMLElement>('.presume-screen')
  const meta=root?.querySelector<HTMLElement>('.pres-challenge-meta')
  if(!root||!meta)return
  if(statsLoading){statsQueued=true;return}
  statsLoading=true
  try{
    const since=new Date();since.setDate(since.getDate()-400)
    const sinceKey=localDateKey(since)
    const [postsRes,membersRes]=await Promise.all([
      supabase.from('social_posts')
        .select('member_id,prompt_date')
        .eq('is_prompt_response',true)
        .gte('prompt_date',sinceKey),
      supabase.from('family_members')
        .select('id',{count:'exact'})
        .eq('active',true)
    ])
    if(postsRes.error||membersRes.error)return
    const posts=(postsRes.data||[]) as Array<{member_id:string;prompt_date:string|null}>
    const today=localDateKey()
    const participants=new Set(posts.filter(row=>row.prompt_date===today).map(row=>row.member_id)).size
    const total=membersRes.count??(membersRes.data||[]).length
    const activeDays=new Set(posts.map(row=>row.prompt_date).filter((value):value is string=>!!value))
    let streak=0
    const cursor=new Date()
    for(let i=0;i<400;i++){
      const key=localDateKey(cursor)
      if(activeDays.has(key)){
        streak++
        cursor.setDate(cursor.getDate()-1)
        continue
      }
      if(i===0){cursor.setDate(cursor.getDate()-1);continue}
      break
    }
    const markup=`<span class="pres-chip" data-challenge-participation>${participants}/${total} hoy</span>${streak?`<span class="pres-chip" data-challenge-streak>${streak} día${streak===1?'':'s'} seguido${streak===1?'':'s'}</span>`:''}`
    if(meta.innerHTML!==markup)meta.innerHTML=markup
  }catch(error){
    console.warn('PRESUME challenge stats failed',error)
  }finally{
    statsLoading=false
    if(statsQueued){statsQueued=false;scheduleChallengeStats(120)}
  }
}

function scheduleChallengeStats(delay=180){
  if(statsTimer!==null)window.clearTimeout(statsTimer)
  statsTimer=window.setTimeout(()=>{
    statsTimer=null
    void syncChallengeStats()
  },delay)
}

function compactChallenge(){
  const root=document.querySelector<HTMLElement>('.presume-screen')
  if(!root)return
  const challenge=root.querySelector<HTMLElement>('.pres-challenge')
  if(!challenge)return

  const eyebrow=challenge.querySelector<HTMLElement>('.eyebrow')
  if(eyebrow){
    const next=eyebrow.textContent?.replace('FOTO DEL MOMENTO','FOTO')||''
    if(eyebrow.textContent!==next)eyebrow.textContent=next
  }

  const main=challenge.querySelector<HTMLButtonElement>('.pres-main')
  const done=!!main?.classList.contains('done')
  const support=[...challenge.querySelectorAll<HTMLParagraphElement>('p')].find(p=>!p.classList.contains('eyebrow'))
  if(support){
    const next=done?'Ya compartiste tu momento.':'Una foto real, sin preparar.'
    if(support.textContent!==next)support.textContent=next
  }

  if(main){
    const next=done?'Mira a la familia':'PRESUME'
    if(main.textContent!==next)main.textContent=next
  }

  const reminder=root.querySelector<HTMLButtonElement>('.pres-reminder')
  if(reminder){
    const active=reminder.textContent?.toLowerCase().includes('activados')
    const next=active?'Recordatorios activados':'Activar recordatorios'
    if(reminder.textContent!==next)reminder.textContent=next
    if(reminder.parentElement===challenge)challenge.insertAdjacentElement('afterend',reminder)
  }

  decorateQuickActions(root)
  scheduleChallengeStats()
}

let scheduled=false
function schedule(){
  if(scheduled)return
  scheduled=true
  requestAnimationFrame(()=>{
    scheduled=false
    compactChallenge()
  })
}

const observer=new MutationObserver(mutations=>{
  if(mutations.some(mutation=>{
    const target=mutation.target instanceof Element?mutation.target:mutation.target.parentElement
    return !!target?.closest?.('.presume-screen')||[...mutation.addedNodes].some(node=>node instanceof Element&&node.matches?.('.presume-screen,.presume-screen *'))
  }))schedule()
})
observer.observe(document.body,{childList:true,subtree:true})
schedule()

window.addEventListener('beforeunload',()=>{
  observer.disconnect()
  if(statsTimer!==null)window.clearTimeout(statsTimer)
},{once:true})

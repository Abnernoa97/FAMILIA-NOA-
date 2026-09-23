import { supabase } from './supabase'
import { getIdentity } from './core/identity'
import { backView, currentView, enterView } from './core/navigation'

type AssistantStats={
  photos:number
  messages:number
  posts:number
  comments:number
  reactions:number
  unread:number
  activeNames:string[]
  presumeNames:string[]
  totalMembers:number
  newSinceLast:{messages:number;photos:number;posts:number}
}
type AssistantResponse={ok:boolean;assistant:string;text:string;stats:AssistantStats}

const css=`
.noa-card{margin:4px 0 20px;padding:17px 17px 15px;border:1px solid #dfd9cf;border-radius:22px;background:#171716;color:#fff;box-sizing:border-box;overflow:hidden;position:relative}
.noa-card::after{content:"";position:absolute;width:150px;height:150px;right:-70px;top:-85px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.1),transparent 68%);pointer-events:none}
.noa-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.noa-card-title{display:flex;align-items:center;gap:9px}.noa-mark{width:30px;height:30px;border:1px solid rgba(255,255,255,.16);border-radius:50%;display:grid;place-items:center;font:600 12px Georgia,serif}.noa-card-title b{display:block;font:700 12px system-ui}.noa-card-title span{display:block;margin-top:1px;font:600 8px system-ui;letter-spacing:.12em;color:#99958f;text-transform:uppercase}.noa-open{border:0;background:transparent;color:#c9c4bd;font:700 9px system-ui;padding:5px 0;cursor:pointer}
.noa-summary{margin:0;font:500 16px/1.35 Georgia,serif;max-width:560px}.noa-summary.loading{color:#aaa59e}.noa-stats{display:flex;gap:5px;flex-wrap:wrap;margin-top:12px}.noa-stat{padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.075);color:#c8c3bb;font:600 8.5px system-ui}.noa-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:13px;padding-top:11px;border-top:1px solid rgba(255,255,255,.09)}.noa-card-foot span{font:500 9px system-ui;color:#8f8b84}.noa-card-foot button{border:0;border-radius:999px;background:#f3efe8;color:#171716;padding:8px 12px;font:700 9px system-ui;cursor:pointer}
.noa-modal{position:fixed;inset:0;z-index:1350;background:#f5f2eb;color:#171716;overflow:auto;padding:0 15px calc(28px + env(safe-area-inset-bottom));box-sizing:border-box}.noa-inner{width:100%;max-width:760px;margin:0 auto}.noa-top{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:max(14px,env(safe-area-inset-top)) 0 12px;background:rgba(245,242,235,.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.noa-back{width:38px;height:38px;border:1px solid #ded8ce;background:transparent;border-radius:50%;font-size:24px;display:grid;place-items:center;cursor:pointer}.noa-brand{text-align:center}.noa-brand b{display:block;font:600 21px Georgia,serif}.noa-brand span{display:block;font:700 7px system-ui;letter-spacing:.18em;color:#969087;margin-top:2px}.noa-spacer{width:38px}
.noa-hero{padding:22px 3px 18px}.noa-eyebrow{font:700 8px system-ui;letter-spacing:.13em;color:#969087;text-transform:uppercase;margin-bottom:7px}.noa-hero h2{font:500 31px/1.05 Georgia,serif;margin:0 0 8px}.noa-hero p{margin:0;color:#777169;font:12px/1.45 system-ui}
.noa-chat{display:grid;gap:10px;padding:5px 0 14px}.noa-bubble{max-width:88%;border-radius:18px;padding:12px 14px;font:12px/1.45 system-ui;white-space:pre-wrap}.noa-bubble.assistant{justify-self:start;background:#171716;color:#f6f3ed;border-bottom-left-radius:6px}.noa-bubble.user{justify-self:end;background:#e8e2d8;color:#171716;border-bottom-right-radius:6px}.noa-bubble.loading{color:#aaa59e}
.noa-prompts{display:flex;gap:6px;overflow-x:auto;padding:2px 0 13px;scrollbar-width:none}.noa-prompts::-webkit-scrollbar{display:none}.noa-prompts button{white-space:nowrap;border:1px solid #ddd7cd;border-radius:999px;background:#fff;color:#37342f;padding:8px 11px;font:650 9px system-ui;cursor:pointer}
.noa-form{position:sticky;bottom:0;display:flex;gap:7px;padding:10px 0 calc(8px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(245,242,235,0),#f5f2eb 23%)}.noa-input{min-width:0;flex:1;border:1px solid #dcd6cc;border-radius:999px;background:#fff;color:#171716;padding:0 14px;height:44px;font:12px system-ui;outline:none}.noa-send{width:44px;height:44px;border:0;border-radius:50%;background:#171716;color:#fff;font-size:17px;cursor:pointer}.noa-send:disabled{opacity:.45}
.dark-mode .noa-modal{background:#181818;color:#f5f5f2}.dark-mode .noa-top{background:rgba(24,24,24,.95)}.dark-mode .noa-back{border-color:#393936;color:#f5f5f2}.dark-mode .noa-hero p{color:#aaa59e}.dark-mode .noa-prompts button,.dark-mode .noa-input{background:#222220;border-color:#393936;color:#f5f5f2}.dark-mode .noa-form{background:linear-gradient(180deg,rgba(24,24,24,0),#181818 23%)}
`

let modal:HTMLElement|null=null
let cardRoot:HTMLElement|null=null
let lastResponse:AssistantResponse|null=null
let busy=false

function injectCss(){if(document.querySelector('#noa-assistant-css'))return;const style=document.createElement('style');style.id='noa-assistant-css';style.textContent=css;document.head.appendChild(style)}
function esc(value:string){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char))}

async function ask(question=''):Promise<AssistantResponse>{
  const {data,error}=await supabase.functions.invoke('family-assistant',{body:{question}})
  if(error)throw error
  if(!data?.ok)throw new Error(data?.error||'NOA no pudo responder.')
  return data as AssistantResponse
}

function statsMarkup(stats:AssistantStats){
  const items=[`${stats.photos} foto${stats.photos===1?'':'s'}`,`${stats.messages} mensaje${stats.messages===1?'':'s'}`,`${stats.posts} PRESUME`,`${stats.activeNames.length}/${stats.totalMembers} activos`]
  return items.map(item=>`<span class="noa-stat">${esc(item)}</span>`).join('')
}

function renderCard(response:AssistantResponse){
  if(!cardRoot)return
  const summary=cardRoot.querySelector<HTMLElement>('[data-noa-summary]')
  const stats=cardRoot.querySelector<HTMLElement>('[data-noa-stats]')
  if(summary){summary.classList.remove('loading');summary.textContent=response.text}
  if(stats)stats.innerHTML=statsMarkup(response.stats)
}

async function refreshCard(){
  if(!cardRoot||busy)return
  busy=true
  try{lastResponse=await ask('Dame mi resumen del día');renderCard(lastResponse)}
  catch(error){console.error('NOA summary failed',error);const summary=cardRoot.querySelector<HTMLElement>('[data-noa-summary]');if(summary){summary.classList.remove('loading');summary.textContent='No pude preparar tu resumen ahora. Puedes intentarlo de nuevo.'}}
  finally{busy=false}
}

function closeModal(useHistory=true){
  modal?.remove();modal=null
  if(useHistory&&currentView()==='assistant')backView()
}

function appendBubble(kind:'assistant'|'user',text:string,loading=false){
  const chat=modal?.querySelector<HTMLElement>('[data-noa-chat]')
  if(!chat)return null
  const bubble=document.createElement('div');bubble.className=`noa-bubble ${kind}${loading?' loading':''}`;bubble.textContent=text;chat.appendChild(bubble);bubble.scrollIntoView({behavior:'smooth',block:'end'});return bubble
}

async function sendQuestion(question:string){
  const clean=question.trim();if(!clean||busy||!modal)return
  appendBubble('user',clean)
  const pending=appendBubble('assistant','Pensando…',true)
  const input=modal.querySelector<HTMLInputElement>('[data-noa-input]');const send=modal.querySelector<HTMLButtonElement>('[data-noa-send]')
  if(input)input.value='';if(send)send.disabled=true;busy=true
  try{
    const response=await ask(clean);lastResponse=response
    if(pending){pending.classList.remove('loading');pending.textContent=response.text}
    renderCard(response)
  }catch(error){console.error('NOA question failed',error);if(pending){pending.classList.remove('loading');pending.textContent='No pude consultar la actividad ahora. Inténtalo otra vez.'}}
  finally{busy=false;if(send)send.disabled=false;input?.focus()}
}

function openModal(){
  if(modal)return
  const identity=getIdentity();if(!identity?.memberId)return
  enterView('assistant')
  modal=document.createElement('section');modal.className='noa-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Asistente NOA')
  modal.innerHTML=`<div class="noa-inner"><header class="noa-top"><button class="noa-back" type="button" aria-label="Volver">‹</button><div class="noa-brand"><b>NOA</b><span>ASISTENTE FAMILIAR</span></div><div class="noa-spacer"></div></header><section class="noa-hero"><div class="noa-eyebrow">Solo para ${esc(identity.name)}</div><h2>¿Qué quieres saber?</h2><p>NOA resume la actividad de FAMILIA NOA usando solamente los datos de la app.</p></section><div class="noa-chat" data-noa-chat></div><div class="noa-prompts"><button type="button" data-prompt="¿Qué me perdí hoy?">¿Qué me perdí?</button><button type="button" data-prompt="¿Quién estuvo activo hoy?">¿Quién estuvo?</button><button type="button" data-prompt="¿Cuántas fotos se compartieron hoy?">Fotos de hoy</button><button type="button" data-prompt="¿Quién escribió en el chat hoy?">Chat de hoy</button><button type="button" data-prompt="¿Quién ya hizo PRESUME hoy?">PRESUME</button></div><form class="noa-form" data-noa-form><input class="noa-input" data-noa-input maxlength="300" autocomplete="off" placeholder="Pregúntale a NOA…"><button class="noa-send" data-noa-send type="submit" aria-label="Enviar">↑</button></form></div>`
  document.body.appendChild(modal)
  modal.querySelector('.noa-back')?.addEventListener('click',()=>closeModal(true))
  modal.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach(button=>button.addEventListener('click',()=>void sendQuestion(button.dataset.prompt||'')))
  modal.querySelector<HTMLFormElement>('[data-noa-form]')?.addEventListener('submit',event=>{event.preventDefault();const input=modal?.querySelector<HTMLInputElement>('[data-noa-input]');if(input)void sendQuestion(input.value)})
  appendBubble('assistant',lastResponse?.text||'Preparando tu resumen…',!lastResponse)
  if(!lastResponse)void ask('Dame mi resumen del día').then(response=>{lastResponse=response;const loading=modal?.querySelector<HTMLElement>('.noa-bubble.assistant.loading');if(loading){loading.classList.remove('loading');loading.textContent=response.text}renderCard(response)}).catch(()=>{const loading=modal?.querySelector<HTMLElement>('.noa-bubble.assistant.loading');if(loading){loading.classList.remove('loading');loading.textContent='No pude preparar tu resumen ahora.'}})
}

function mountCard(){
  const menu=document.querySelector<HTMLElement>('.profile-menu')
  if(!menu||menu.querySelector('[data-noa-card]'))return
  const hero=menu.querySelector<HTMLElement>('.profile-hero');if(!hero)return
  const identity=getIdentity();if(!identity?.memberId)return
  const card=document.createElement('section');card.className='noa-card';card.dataset.noaCard='1'
  card.innerHTML=`<div class="noa-card-head"><div class="noa-card-title"><span class="noa-mark">N</span><div><b>NOA</b><span>Tu familia hoy</span></div></div><button type="button" class="noa-open" data-noa-open>ABRIR →</button></div><p class="noa-summary loading" data-noa-summary>Preparando tu resumen…</p><div class="noa-stats" data-noa-stats></div><div class="noa-card-foot"><span>Fotos · Chat · PRESUME · Actividad</span><button type="button" data-noa-open>Pregúntame</button></div>`
  hero.insertAdjacentElement('afterend',card);cardRoot=card
  card.querySelectorAll('[data-noa-open]').forEach(button=>button.addEventListener('click',openModal))
  void refreshCard()
}

injectCss()
const observer=new MutationObserver(()=>mountCard())
observer.observe(document.body,{childList:true,subtree:true})
mountCard()

window.addEventListener('popstate',()=>{if(modal&&currentView()!=='assistant')closeModal(false)})
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal)closeModal(true)})
window.addEventListener('beforeunload',()=>observer.disconnect(),{once:true})

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

.noa-fab{position:fixed;right:17px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:1290;width:58px;height:58px;border:0;border-radius:50%;background:#171716;color:#fff;box-shadow:0 12px 28px rgba(0,0,0,.22);display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .18s ease,box-shadow .18s ease}.noa-fab:active{transform:scale(.94)}.noa-fab-core{font:600 20px Georgia,serif;letter-spacing:-.02em}.noa-fab-mic{position:absolute;right:-1px;bottom:-1px;width:20px;height:20px;border:3px solid #f5f2eb;border-radius:50%;background:#fff;color:#171716;display:grid;place-items:center}.noa-fab-mic svg{width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.noa-fab.listening{animation:noaFabPulse 1.15s ease-in-out infinite}.noa-fab.speaking{box-shadow:0 0 0 7px rgba(23,23,22,.08),0 12px 28px rgba(0,0,0,.2)}@keyframes noaFabPulse{50%{transform:scale(1.06);box-shadow:0 0 0 10px rgba(23,23,22,.08),0 12px 28px rgba(0,0,0,.2)}}
.noa-voice-panel{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:1320;width:min(calc(100vw - 28px),430px);padding:13px 14px;border-radius:20px;background:rgba(23,23,22,.96);color:#fff;box-shadow:0 16px 38px rgba(0,0,0,.24);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-sizing:border-box}.noa-voice-top{display:flex;align-items:center;gap:9px}.noa-voice-dot{width:9px;height:9px;border-radius:50%;background:#f3efe8;box-shadow:0 0 0 5px rgba(255,255,255,.08)}.noa-voice-panel.listening .noa-voice-dot{animation:noaDot 1s ease-in-out infinite}@keyframes noaDot{50%{opacity:.35;transform:scale(.75)}}.noa-voice-label{flex:1;font:700 10px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#bcb7af}.noa-voice-close{border:0;background:transparent;color:#aaa59d;font-size:20px;line-height:1;padding:2px 4px;cursor:pointer}.noa-voice-text{margin:8px 0 0;font:500 16px/1.32 Georgia,serif;min-height:21px}.noa-voice-answer{margin:8px 0 0;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);font:11px/1.4 system-ui;color:#d2cdc6;white-space:pre-wrap}

.noa-modal{position:fixed;inset:0;z-index:1350;background:#f5f2eb;color:#171716;overflow:auto;padding:0 15px calc(28px + env(safe-area-inset-bottom));box-sizing:border-box}.noa-inner{width:100%;max-width:760px;margin:0 auto}.noa-top{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:max(14px,env(safe-area-inset-top)) 0 12px;background:rgba(245,242,235,.95);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.noa-back{width:38px;height:38px;border:1px solid #ded8ce;background:transparent;border-radius:50%;font-size:24px;display:grid;place-items:center;cursor:pointer}.noa-brand{text-align:center}.noa-brand b{display:block;font:600 21px Georgia,serif}.noa-brand span{display:block;font:700 7px system-ui;letter-spacing:.18em;color:#969087;margin-top:2px}.noa-spacer{width:38px}
.noa-hero{padding:22px 3px 18px}.noa-eyebrow{font:700 8px system-ui;letter-spacing:.13em;color:#969087;text-transform:uppercase;margin-bottom:7px}.noa-hero h2{font:500 31px/1.05 Georgia,serif;margin:0 0 8px}.noa-hero p{margin:0;color:#777169;font:12px/1.45 system-ui}
.noa-chat{display:grid;gap:10px;padding:5px 0 14px}.noa-bubble{max-width:88%;border-radius:18px;padding:12px 14px;font:12px/1.45 system-ui;white-space:pre-wrap}.noa-bubble.assistant{justify-self:start;background:#171716;color:#f6f3ed;border-bottom-left-radius:6px}.noa-bubble.user{justify-self:end;background:#e8e2d8;color:#171716;border-bottom-right-radius:6px}.noa-bubble.loading{color:#aaa59e}
.noa-prompts{display:flex;gap:6px;overflow-x:auto;padding:2px 0 13px;scrollbar-width:none}.noa-prompts::-webkit-scrollbar{display:none}.noa-prompts button{white-space:nowrap;border:1px solid #ddd7cd;border-radius:999px;background:#fff;color:#37342f;padding:8px 11px;font:650 9px system-ui;cursor:pointer}
.noa-form{position:sticky;bottom:0;display:flex;gap:7px;padding:10px 0 calc(8px + env(safe-area-inset-bottom));background:linear-gradient(180deg,rgba(245,242,235,0),#f5f2eb 23%)}.noa-input{min-width:0;flex:1;border:1px solid #dcd6cc;border-radius:999px;background:#fff;color:#171716;padding:0 14px;height:44px;font:12px system-ui;outline:none}.noa-send,.noa-mic{width:44px;height:44px;border:0;border-radius:50%;background:#171716;color:#fff;font-size:17px;cursor:pointer;display:grid;place-items:center}.noa-mic{background:#e8e2d8;color:#171716}.noa-mic svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.noa-send:disabled{opacity:.45}
.dark-mode .noa-modal{background:#181818;color:#f5f5f2}.dark-mode .noa-top{background:rgba(24,24,24,.95)}.dark-mode .noa-back{border-color:#393936;color:#f5f5f2}.dark-mode .noa-hero p{color:#aaa59e}.dark-mode .noa-prompts button,.dark-mode .noa-input{background:#222220;border-color:#393936;color:#f5f5f2}.dark-mode .noa-form{background:linear-gradient(180deg,rgba(24,24,24,0),#181818 23%)}
@media(max-width:520px){.noa-fab{right:14px;bottom:calc(15px + env(safe-area-inset-bottom));width:56px;height:56px}.noa-voice-panel{bottom:calc(82px + env(safe-area-inset-bottom))}}
`

const MIC_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6"/></svg>'

let modal:HTMLElement|null=null
let cardRoot:HTMLElement|null=null
let launcher:HTMLButtonElement|null=null
let voicePanel:HTMLElement|null=null
let recognition:any=null
let lastResponse:AssistantResponse|null=null
let requestBusy=false
let cardBusy=false
let voiceSubmitted=false
let voiceTranscript=''

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
  if(!cardRoot||cardBusy)return
  cardBusy=true
  try{lastResponse=await ask('Dame mi resumen del día');renderCard(lastResponse)}
  catch(error){console.error('NOA summary failed',error);const summary=cardRoot.querySelector<HTMLElement>('[data-noa-summary]');if(summary){summary.classList.remove('loading');summary.textContent='No pude preparar tu resumen ahora. Puedes intentarlo de nuevo.'}}
  finally{cardBusy=false}
}

function pickVoice(){
  const voices=window.speechSynthesis?.getVoices?.()||[]
  return voices.find(voice=>voice.lang.toLowerCase()==='es-mx')||voices.find(voice=>voice.lang.toLowerCase().startsWith('es'))||null
}

function speak(text:string){
  if(!('speechSynthesis'in window)||!text)return
  try{
    window.speechSynthesis.cancel()
    const utterance=new SpeechSynthesisUtterance(text)
    utterance.lang='es-MX';utterance.rate=.98;utterance.pitch=1
    const voice=pickVoice();if(voice)utterance.voice=voice
    utterance.onstart=()=>launcher?.classList.add('speaking')
    utterance.onend=()=>launcher?.classList.remove('speaking')
    utterance.onerror=()=>launcher?.classList.remove('speaking')
    window.speechSynthesis.speak(utterance)
  }catch(error){console.warn('NOA speech failed',error)}
}

function removeVoicePanel(){voicePanel?.remove();voicePanel=null;launcher?.classList.remove('listening')}
function ensureVoicePanel(){
  if(voicePanel)return voicePanel
  const panel=document.createElement('section');panel.className='noa-voice-panel';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite')
  panel.innerHTML=`<div class="noa-voice-top"><i class="noa-voice-dot"></i><span class="noa-voice-label">NOA</span><button type="button" class="noa-voice-close" aria-label="Cerrar">×</button></div><p class="noa-voice-text" data-noa-voice-text>Te escucho…</p><div class="noa-voice-answer" data-noa-voice-answer hidden></div>`
  document.body.appendChild(panel);voicePanel=panel
  panel.querySelector('.noa-voice-close')?.addEventListener('click',()=>{try{recognition?.stop?.()}catch{}removeVoicePanel()})
  return panel
}

function setVoiceState(label:string,text:string,answer=''){
  const panel=ensureVoicePanel();panel.classList.toggle('listening',label==='Escuchando')
  const labelEl=panel.querySelector<HTMLElement>('.noa-voice-label');const textEl=panel.querySelector<HTMLElement>('[data-noa-voice-text]');const answerEl=panel.querySelector<HTMLElement>('[data-noa-voice-answer]')
  if(labelEl)labelEl.textContent=label
  if(textEl)textEl.textContent=text
  if(answerEl){answerEl.hidden=!answer;answerEl.textContent=answer}
}

async function answerVoice(question:string){
  const clean=question.trim();if(!clean||requestBusy)return
  requestBusy=true;voiceSubmitted=true;launcher?.classList.remove('listening');setVoiceState('Pensando',clean)
  try{
    const response=await ask(clean);lastResponse=response;renderCard(response)
    setVoiceState('NOA',clean,response.text);speak(response.text)
  }catch(error){
    console.error('NOA voice question failed',error)
    const message='No pude consultar la actividad ahora. Inténtalo otra vez.';setVoiceState('NOA',clean,message);speak(message)
  }finally{requestBusy=false}
}

function startVoice(){
  const identity=getIdentity();if(!identity?.memberId)return
  if(requestBusy)return
  try{window.speechSynthesis?.cancel?.()}catch{}
  const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition
  if(!Recognition){
    openModal();setTimeout(()=>modal?.querySelector<HTMLInputElement>('[data-noa-input]')?.focus(),50);return
  }
  try{recognition?.abort?.()}catch{}
  voiceTranscript='';voiceSubmitted=false
  recognition=new Recognition();recognition.lang='es-MX';recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=1
  recognition.onstart=()=>{launcher?.classList.add('listening');setVoiceState('Escuchando','Te escucho…')}
  recognition.onresult=(event:any)=>{
    let interim='';let final=''
    for(let i=event.resultIndex;i<event.results.length;i++){
      const text=String(event.results[i][0]?.transcript||'').trim()
      if(event.results[i].isFinal)final+=`${text} `;else interim+=`${text} `
    }
    const heard=(final||interim||voiceTranscript).trim();if(heard){voiceTranscript=heard;setVoiceState('Escuchando',heard)}
    if(final.trim()&&!voiceSubmitted){void answerVoice(final.trim());try{recognition.stop()}catch{}}
  }
  recognition.onerror=(event:any)=>{
    launcher?.classList.remove('listening')
    if(event?.error==='aborted')return
    const message=event?.error==='not-allowed'?'Necesito permiso para usar el micrófono.':'No te escuché bien. Toca NOA e inténtalo otra vez.'
    setVoiceState('NOA',message)
  }
  recognition.onend=()=>{
    launcher?.classList.remove('listening')
    if(!voiceSubmitted&&voiceTranscript.trim())void answerVoice(voiceTranscript.trim())
    else if(!voiceSubmitted&&!voiceTranscript.trim())setVoiceState('NOA','No te escuché. Toca el botón para intentarlo otra vez.')
  }
  try{recognition.start()}catch(error){console.error('NOA microphone failed',error);openModal()}
}

function mountLauncher(){
  if(launcher?.isConnected)return
  if(!document.querySelector('.shell')||!getIdentity()?.memberId)return
  const button=document.createElement('button');button.type='button';button.className='noa-fab';button.setAttribute('aria-label','Hablar con NOA');button.title='Hablar con NOA'
  button.innerHTML=`<span class="noa-fab-core">N</span><span class="noa-fab-mic">${MIC_ICON}</span>`
  button.addEventListener('click',startVoice);document.body.appendChild(button);launcher=button
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
  const clean=question.trim();if(!clean||requestBusy||!modal)return
  appendBubble('user',clean)
  const pending=appendBubble('assistant','Pensando…',true)
  const input=modal.querySelector<HTMLInputElement>('[data-noa-input]');const send=modal.querySelector<HTMLButtonElement>('[data-noa-send]')
  if(input)input.value='';if(send)send.disabled=true;requestBusy=true
  try{
    const response=await ask(clean);lastResponse=response
    if(pending){pending.classList.remove('loading');pending.textContent=response.text}
    renderCard(response);speak(response.text)
  }catch(error){console.error('NOA question failed',error);if(pending){pending.classList.remove('loading');pending.textContent='No pude consultar la actividad ahora. Inténtalo otra vez.'}}
  finally{requestBusy=false;if(send)send.disabled=false;input?.focus()}
}

function openModal(){
  if(modal)return
  const identity=getIdentity();if(!identity?.memberId)return
  enterView('assistant')
  modal=document.createElement('section');modal.className='noa-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Asistente NOA')
  modal.innerHTML=`<div class="noa-inner"><header class="noa-top"><button class="noa-back" type="button" aria-label="Volver">‹</button><div class="noa-brand"><b>NOA</b><span>ASISTENTE FAMILIAR</span></div><div class="noa-spacer"></div></header><section class="noa-hero"><div class="noa-eyebrow">Solo para ${esc(identity.name)}</div><h2>¿Qué quieres saber?</h2><p>Toca el micrófono y pregúntame. También puedes escribir.</p></section><div class="noa-chat" data-noa-chat></div><div class="noa-prompts"><button type="button" data-prompt="¿Qué me perdí hoy?">¿Qué me perdí?</button><button type="button" data-prompt="¿Quién estuvo activo hoy?">¿Quién estuvo?</button><button type="button" data-prompt="¿Cuántas fotos se compartieron hoy?">Fotos de hoy</button><button type="button" data-prompt="¿Quién escribió en el chat hoy?">Chat de hoy</button><button type="button" data-prompt="¿Quién ya hizo PRESUME hoy?">PRESUME</button></div><form class="noa-form" data-noa-form><button class="noa-mic" data-noa-mic type="button" aria-label="Hablar">${MIC_ICON}</button><input class="noa-input" data-noa-input maxlength="300" autocomplete="off" placeholder="Pregúntale a NOA…"><button class="noa-send" data-noa-send type="submit" aria-label="Enviar">↑</button></form></div>`
  document.body.appendChild(modal)
  modal.querySelector('.noa-back')?.addEventListener('click',()=>closeModal(true))
  modal.querySelector('[data-noa-mic]')?.addEventListener('click',startVoice)
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

function mount(){mountLauncher();mountCard()}

injectCss()
const observer=new MutationObserver(()=>mount())
observer.observe(document.body,{childList:true,subtree:true})
mount()

window.addEventListener('popstate',()=>{if(modal&&currentView()!=='assistant')closeModal(false)})
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal)closeModal(true)})
window.addEventListener('beforeunload',()=>{observer.disconnect();try{recognition?.abort?.()}catch{}try{window.speechSynthesis?.cancel?.()}catch{}},{once:true})

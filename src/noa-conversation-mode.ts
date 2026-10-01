const SESSION_IDLE_MS=45_000
const RESUME_AFTER_SPEECH_MS=420
const RETRY_AFTER_SILENCE_MS=700

let active=false
let idleDeadline=0
let resumeTimer:number|undefined
let expiryTimer:number|undefined
let closing=false
let wrappedSpeech=false
let autoResumeClick=false

function clearTimers(){
  if(resumeTimer){window.clearTimeout(resumeTimer);resumeTimer=undefined}
  if(expiryTimer){window.clearTimeout(expiryTimer);expiryTimer=undefined}
}

function markActive(){
  active=true
  idleDeadline=Date.now()+SESSION_IDLE_MS
  document.documentElement.setAttribute('data-noa-conversation','active')
  const launcher=document.querySelector<HTMLButtonElement>('.noa-fab')
  if(launcher)launcher.setAttribute('aria-label','Continuar conversación con NOA')
  armExpiry()
}

function armExpiry(){
  if(expiryTimer)window.clearTimeout(expiryTimer)
  const remaining=Math.max(0,idleDeadline-Date.now())
  expiryTimer=window.setTimeout(()=>{
    if(Date.now()>=idleDeadline)endSession(true)
    else armExpiry()
  },remaining+80)
}

function endSession(closePanel=false){
  active=false
  idleDeadline=0
  clearTimers()
  document.documentElement.removeAttribute('data-noa-conversation')
  const launcher=document.querySelector<HTMLButtonElement>('.noa-fab')
  if(launcher)launcher.setAttribute('aria-label','Hablar con NOA')
  if(closePanel&&!closing){
    const close=document.querySelector<HTMLButtonElement>('.noa-voice-close')
    if(close){
      closing=true
      try{close.click()}catch{}
      closing=false
    }
  }
}

function launcherButton(){
  return document.querySelector<HTMLButtonElement>('.noa-fab')||document.querySelector<HTMLButtonElement>('[data-noa-mic]')
}

function resumeListening(delay=RESUME_AFTER_SPEECH_MS,refreshWindow=false){
  if(!active)return
  if(refreshWindow){
    idleDeadline=Date.now()+SESSION_IDLE_MS
    armExpiry()
  }
  if(Date.now()>=idleDeadline){endSession(true);return}
  if(resumeTimer)window.clearTimeout(resumeTimer)
  resumeTimer=window.setTimeout(()=>{
    resumeTimer=undefined
    if(!active||Date.now()>=idleDeadline){endSession(true);return}
    if(document.hidden){endSession(true);return}
    const button=launcherButton()
    if(!button){
      resumeListening(350,false)
      return
    }
    try{
      autoResumeClick=true
      button.click()
    }catch(error){
      console.warn('NOA conversation resume failed',error)
    }finally{
      autoResumeClick=false
    }
  },delay)
}

function wrapSpeech(){
  if(wrappedSpeech)return
  const synth:any=(window as any).speechSynthesis
  if(!synth||typeof synth.speak!=='function')return
  const originalSpeak=synth.speak.bind(synth)
  synth.speak=(utterance:any)=>{
    const previousEnd=utterance?.onend
    const previousError=utterance?.onerror
    if(utterance){
      utterance.onend=(event:any)=>{
        try{previousEnd?.call(utterance,event)}catch{}
        if(active)resumeListening(RESUME_AFTER_SPEECH_MS,true)
      }
      utterance.onerror=(event:any)=>{
        try{previousError?.call(utterance,event)}catch{}
        if(active)resumeListening(650,true)
      }
    }
    return originalSpeak(utterance)
  }
  wrappedSpeech=true
  document.documentElement.setAttribute('data-noa-conversation-build','20261001-v3')
}

function isVoiceStart(target:Element|null){
  return !!target?.closest('.noa-fab,[data-noa-mic]')
}

function isVoiceClose(target:Element|null){
  return !!target?.closest('.noa-voice-close')
}

document.addEventListener('click',event=>{
  const target=event.target as Element|null
  if(isVoiceClose(target)){
    if(!closing)endSession(false)
    return
  }
  if(isVoiceStart(target)&&!autoResumeClick)markActive()
},true)

const voiceObserver=new MutationObserver(()=>{
  if(!active)return
  const text=document.querySelector<HTMLElement>('[data-noa-voice-text]')?.textContent?.trim().toLowerCase()||''
  if(!text)return
  if(text.includes('necesito permiso')){
    endSession(false)
    return
  }
  if(text.startsWith('no te escuché')||text.startsWith('no te escuche')){
    if(Date.now()<idleDeadline)resumeListening(RETRY_AFTER_SILENCE_MS,false)
    else endSession(true)
  }
})
voiceObserver.observe(document.body,{childList:true,subtree:true,characterData:true})

const speechObserver=new MutationObserver(()=>wrapSpeech())
speechObserver.observe(document.documentElement,{childList:true,subtree:true})
wrapSpeech()

function stopWhenHidden(){if(document.hidden)endSession(true)}
document.addEventListener('visibilitychange',stopWhenHidden)
window.addEventListener('pagehide',()=>endSession(true))

;(window as any).__familiaNoaConversation={
  start:()=>markActive(),
  stop:()=>endSession(true),
  get active(){return active},
  get remainingMs(){return Math.max(0,idleDeadline-Date.now())},
}

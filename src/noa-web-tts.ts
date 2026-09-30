import { supabase } from './supabase'

const nativeAndroid=/FAMILIA-NOA-Android/i.test(navigator.userAgent)
const nativeBridge=(window as any).FamiliaNoaNative
const hasNativeSpeak=!!nativeBridge&&typeof nativeBridge.speak==='function'

if(nativeAndroid&&!hasNativeSpeak){
  const originalSynth=(window as any).speechSynthesis
  const originalSpeak=typeof originalSynth?.speak==='function'?originalSynth.speak.bind(originalSynth):null
  const originalCancel=typeof originalSynth?.cancel==='function'?originalSynth.cancel.bind(originalSynth):null
  const originalGetVoices=typeof originalSynth?.getVoices==='function'?originalSynth.getVoices.bind(originalSynth):()=>[]
  let audio:HTMLAudioElement|null=null
  let objectUrl=''
  let requestId=0
  let statusTimer:number|undefined

  const ensureStatus=()=>{
    let el=document.querySelector<HTMLElement>('[data-noa-tts-status]')
    if(el)return el
    el=document.createElement('div')
    el.dataset.noaTtsStatus='1'
    el.style.cssText='position:fixed;left:50%;bottom:calc(104px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:1600;max-width:calc(100vw - 36px);padding:9px 13px;border-radius:999px;background:rgba(23,23,22,.94);color:#fff;font:700 10px system-ui;letter-spacing:.02em;box-shadow:0 10px 30px rgba(0,0,0,.22);opacity:0;pointer-events:none;transition:opacity .18s ease;text-align:center;white-space:nowrap'
    document.body.appendChild(el)
    return el
  }

  const setStatus=(value:string,linger=0)=>{
    const label=document.querySelector<HTMLElement>('.noa-voice-label')
    if(label)label.textContent=value
    const el=ensureStatus()
    el.textContent=value
    el.style.opacity='1'
    if(statusTimer)window.clearTimeout(statusTimer)
    if(linger>0)statusTimer=window.setTimeout(()=>{el.style.opacity='0'},linger)
  }

  const cleanup=()=>{
    if(audio){
      try{audio.pause()}catch{}
      audio.src=''
      audio.onplay=null
      audio.onended=null
      audio.onerror=null
      audio=null
    }
    if(objectUrl){
      try{URL.revokeObjectURL(objectUrl)}catch{}
      objectUrl=''
    }
  }

  const trySystemVoice=(utterance:any,text:string)=>{
    if(!originalSpeak)return false
    try{
      const U=(window as any).SpeechSynthesisUtterance
      if(!U)return false
      const fallback=new U(text)
      fallback.lang='es-MX'
      fallback.rate=.96
      fallback.pitch=1
      const voices=originalGetVoices()||[]
      fallback.voice=voices.find((voice:any)=>String(voice.lang||'').toLowerCase()==='es-mx')||voices.find((voice:any)=>String(voice.lang||'').toLowerCase().startsWith('es'))||null
      fallback.onstart=()=>{
        setStatus('Hablando…')
        try{utterance?.onstart?.(new Event('start'))}catch{}
      }
      fallback.onend=()=>{
        setStatus('NOA',900)
        try{utterance?.onend?.(new Event('end'))}catch{}
      }
      fallback.onerror=()=>{
        setStatus('No pude reproducir la voz · VOICE-DEVICE',3500)
        try{utterance?.onerror?.(new Event('error'))}catch{}
      }
      try{originalCancel?.()}catch{}
      originalSpeak(fallback)
      return true
    }catch{return false}
  }

  const speakCloud=async(utterance:any)=>{
    const text=String(utterance?.text||'').replace(/\s+/g,' ').trim().slice(0,900)
    if(!text)return
    const mine=++requestId
    cleanup()
    setStatus('Preparando voz…')

    try{
      const {data}=await supabase.auth.getSession()
      const token=data.session?.access_token||''
      if(!token)throw new Error('VOICE-AUTH')

      const response=await fetch('/api/noa-voice',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':`Bearer ${token}`,
        },
        body:JSON.stringify({text}),
        cache:'no-store',
      })
      if(mine!==requestId)return
      if(!response.ok)throw new Error(`VOICE-HTTP-${response.status}`)

      const blob=await response.blob()
      if(!blob.size)throw new Error('VOICE-EMPTY')
      objectUrl=URL.createObjectURL(blob)
      const player=new Audio(objectUrl)
      audio=player
      player.preload='auto'
      player.volume=1
      player.playbackRate=.98
      player.onplay=()=>{
        if(mine!==requestId)return
        setStatus('Hablando…')
        try{utterance?.onstart?.(new Event('start'))}catch{}
      }
      player.onended=()=>{
        if(mine!==requestId)return
        setStatus('NOA',900)
        try{utterance?.onend?.(new Event('end'))}catch{}
        cleanup()
      }
      player.onerror=()=>{
        if(mine!==requestId)return
        cleanup()
        if(trySystemVoice(utterance,text))return
        setStatus('No pude reproducir la voz · VOICE-PLAY',3500)
        try{utterance?.onerror?.(new Event('error'))}catch{}
      }
      await player.play()
    }catch(error){
      if(mine!==requestId)return
      cleanup()
      const code=String((error as any)?.message||error||'VOICE-CLOUD').slice(0,80)
      document.documentElement.setAttribute('data-noa-tts-error',code)
      if(trySystemVoice(utterance,text))return
      setStatus(`No pude reproducir la voz · ${code}`,3500)
      try{utterance?.onerror?.(new Event('error'))}catch{}
    }
  }

  const cancel=()=>{
    requestId++
    cleanup()
    try{originalCancel?.()}catch{}
    setStatus('NOA',500)
  }

  const localSpeak=(utterance:any)=>{void speakCloud(utterance)}
  const localSynth={
    speak:localSpeak,
    cancel,
    getVoices:()=>{try{return originalGetVoices()||[]}catch{return []}},
    pause:()=>audio?.pause(),
    resume:()=>{void audio?.play().catch(()=>{})},
    paused:false,
    pending:false,
    speaking:false,
  }

  let installed=false
  try{
    Object.defineProperty(window,'speechSynthesis',{configurable:true,enumerable:true,value:localSynth})
    installed=(window as any).speechSynthesis===localSynth
  }catch{}

  if(!installed&&originalSynth){
    try{
      originalSynth.speak=localSpeak
      originalSynth.cancel=cancel
      installed=true
    }catch{}
  }

  if(!(window as any).SpeechSynthesisUtterance){
    class NoaUtterance{
      text:string
      lang='es-MX'
      rate=1
      pitch=1
      volume=1
      voice:any=null
      onstart:any=null
      onend:any=null
      onerror:any=null
      constructor(text=''){this.text=text}
    }
    try{Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:NoaUtterance})}catch{}
  }

  document.documentElement.setAttribute('data-noa-voice-build','20260930-workers-ai-melotts-v2')

  ;(window as any).__familiaNoaSpeakText=(text:string)=>{
    const U=(window as any).SpeechSynthesisUtterance
    const utterance=U?new U(String(text||'')):{text:String(text||'')}
    return speakCloud(utterance)
  }

  ;(window as any).__familiaNoaLocalTts={
    engine:'cloudflare-workers-ai-melotts',
    build:'20260930-workers-ai-melotts-v2',
    installed,
    cancel,
    test:()=>{void (window as any).__familiaNoaSpeakText?.('Hola. Soy NOA.')},
  }

  setStatus(installed?'Voz NOA lista':'Preparando voz…',1200)
  window.addEventListener('beforeunload',cleanup,{once:true})
}

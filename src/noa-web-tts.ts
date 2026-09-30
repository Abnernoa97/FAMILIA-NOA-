const nativeAndroid=/FAMILIA-NOA-Android/i.test(navigator.userAgent)
const nativeBridge=(window as any).FamiliaNoaNative
const hasNativeSpeak=!!nativeBridge&&typeof nativeBridge.speak==='function'

if(nativeAndroid&&!hasNativeSpeak){
  const originalSynth=(window as any).speechSynthesis
  let audio:HTMLAudioElement|null=null
  let requestId=0
  let statusTimer:number|undefined

  const providers=[
    (text:string)=>`https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=es-MX&q=${encodeURIComponent(text)}`,
    (text:string)=>`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es-MX&q=${encodeURIComponent(text)}`,
  ]

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
  }

  const chunks=(value:string)=>{
    const text=String(value||'').replace(/\s+/g,' ').trim().slice(0,1200)
    if(!text)return []
    const out:string[]=[]
    let rest=text
    while(rest.length>170){
      let cut=Math.max(
        rest.lastIndexOf('. ',170),
        rest.lastIndexOf(', ',170),
        rest.lastIndexOf('; ',170),
        rest.lastIndexOf(' ',170),
      )
      if(cut<70)cut=170
      out.push(rest.slice(0,cut+1).trim())
      rest=rest.slice(cut+1).trim()
    }
    if(rest)out.push(rest)
    return out
  }

  const trySystemVoice=(utterance:any,text:string)=>{
    if(!originalSynth||typeof originalSynth.speak!=='function')return false
    try{
      const U=(window as any).SpeechSynthesisUtterance
      if(!U)return false
      const fallback=new U(text)
      fallback.lang='es-MX'
      fallback.rate=.96
      fallback.pitch=1
      const voices=originalSynth.getVoices?.()||[]
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
      originalSynth.cancel?.()
      originalSynth.speak(fallback)
      return true
    }catch{return false}
  }

  const speakRemote=async(utterance:any)=>{
    const text=String(utterance?.text||'').trim()
    if(!text)return
    const mine=++requestId
    cleanup()
    setStatus('Preparando voz…')
    const parts=chunks(text)
    if(!parts.length)return

    let started=false
    const playPart=(index:number,providerIndex=0)=>{
      if(mine!==requestId)return
      if(index>=parts.length){
        setStatus('NOA',900)
        try{utterance?.onend?.(new Event('end'))}catch{}
        cleanup()
        return
      }
      if(providerIndex>=providers.length){
        cleanup()
        if(trySystemVoice(utterance,text))return
        document.documentElement.setAttribute('data-noa-tts-error','VOICE-NET')
        setStatus('No pude reproducir la voz · VOICE-NET',3500)
        try{utterance?.onerror?.(new Event('error'))}catch{}
        return
      }

      const player=new Audio()
      audio=player
      player.preload='auto'
      player.volume=1
      player.playbackRate=.97
      player.src=providers[providerIndex](parts[index])
      player.onplay=()=>{
        if(mine!==requestId)return
        setStatus('Hablando…')
        if(!started){
          started=true
          try{utterance?.onstart?.(new Event('start'))}catch{}
        }
      }
      player.onended=()=>{
        if(mine!==requestId)return
        audio=null
        playPart(index+1,0)
      }
      player.onerror=()=>{
        if(mine!==requestId)return
        try{player.pause()}catch{}
        player.src=''
        if(audio===player)audio=null
        playPart(index,providerIndex+1)
      }
      const promise=player.play()
      if(promise&&typeof promise.catch==='function'){
        promise.catch(()=>{
          if(mine!==requestId)return
          try{player.pause()}catch{}
          player.src=''
          if(audio===player)audio=null
          playPart(index,providerIndex+1)
        })
      }
    }

    playPart(0,0)
  }

  const cancel=()=>{
    requestId++
    cleanup()
    try{originalSynth?.cancel?.()}catch{}
    setStatus('NOA',500)
  }

  const localSpeak=(utterance:any)=>{void speakRemote(utterance)}
  const localSynth={
    speak:localSpeak,
    cancel,
    getVoices:()=>{try{return originalSynth?.getVoices?.()||[]}catch{return []}},
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

  document.documentElement.setAttribute('data-noa-voice-build','20260930-webview-stream-v1')

  ;(window as any).__familiaNoaSpeakText=(text:string)=>{
    const U=(window as any).SpeechSynthesisUtterance
    const utterance=U?new U(String(text||'')):{text:String(text||'')}
    return speakRemote(utterance)
  }

  ;(window as any).__familiaNoaLocalTts={
    engine:'webview-streamed-voice',
    build:'20260930-webview-stream-v1',
    installed,
    cancel,
    test:()=>{void (window as any).__familiaNoaSpeakText?.('Hola. Soy NOA.')},
  }

  setStatus(installed?'Voz NOA lista':'Preparando voz…',1200)

  window.addEventListener('beforeunload',cleanup,{once:true})
}

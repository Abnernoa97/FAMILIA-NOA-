const nativeAndroid=/FAMILIA-NOA-Android/i.test(navigator.userAgent)
const nativeBridge=(window as any).FamiliaNoaNative
const hasNativeSpeak=!!nativeBridge&&typeof nativeBridge.speak==='function'

if(nativeAndroid&&!hasNativeSpeak){
  let audio:HTMLAudioElement|null=null
  let objectUrl=''
  let requestId=0
  let enginePromise:Promise<any>|null=null
  let statusTimer:number|undefined
  let primed=false

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
    if(linger>0){
      statusTimer=window.setTimeout(()=>{el.style.opacity='0'},linger)
    }
  }

  const hideStatus=(delay=700)=>{
    if(statusTimer)window.clearTimeout(statusTimer)
    statusTimer=window.setTimeout(()=>{
      const el=document.querySelector<HTMLElement>('[data-noa-tts-status]')
      if(el)el.style.opacity='0'
    },delay)
  }

  const primeAudio=()=>{
    if(primed)return
    primed=true
    try{
      const AudioCtx=(window as any).AudioContext||(window as any).webkitAudioContext
      if(AudioCtx){
        const ctx=new AudioCtx()
        const gain=ctx.createGain()
        gain.gain.value=0
        const oscillator=ctx.createOscillator()
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.start()
        oscillator.stop(ctx.currentTime+.01)
        Promise.resolve(ctx.resume?.()).catch(()=>{})
        window.setTimeout(()=>{try{ctx.close?.()}catch{}},250)
      }
    }catch{}
  }

  document.addEventListener('pointerdown',primeAudio,{passive:true})

  const cleanup=()=>{
    if(audio){
      try{audio.pause()}catch{}
      audio.src=''
      audio=null
    }
    if(objectUrl){
      try{URL.revokeObjectURL(objectUrl)}catch{}
      objectUrl=''
    }
  }

  const loadEngine=()=>{
    if(!enginePromise)enginePromise=import('@realtimex/piper-tts-web')
    return enginePromise
  }

  const synthesize=async(utterance:any)=>{
    const text=String(utterance?.text||'').trim()
    if(!text)return
    const mine=++requestId
    cleanup()
    setStatus('Preparando voz…')
    try{
      const tts=await loadEngine()
      if(mine!==requestId)return
      const wav=await tts.predict(
        {text:text.slice(0,900),voiceId:'es_MX-claude-high'},
        (progress:any)=>{
          if(mine!==requestId)return
          const loaded=Number(progress?.loaded||0)
          const total=Number(progress?.total||0)
          if(total>0){
            const pct=Math.max(0,Math.min(100,Math.round((loaded/total)*100)))
            setStatus(`Descargando voz ${pct}%…`)
          }else{
            setStatus('Preparando voz…')
          }
        }
      )
      if(mine!==requestId)return
      objectUrl=URL.createObjectURL(wav)
      audio=new Audio(objectUrl)
      audio.preload='auto'
      audio.volume=1
      audio.playbackRate=.97
      audio.onplay=()=>{
        setStatus('Hablando…')
        try{utterance?.onstart?.(new Event('start'))}catch{}
      }
      audio.onended=()=>{
        setStatus('NOA',900)
        try{utterance?.onend?.(new Event('end'))}catch{}
        cleanup()
      }
      audio.onerror=()=>{
        setStatus('No pude reproducir la voz',3500)
        try{utterance?.onerror?.(new Event('error'))}catch{}
        cleanup()
      }
      await audio.play()
    }catch(error){
      console.warn('NOA local neural voice failed',error)
      setStatus('No pude activar la voz',3500)
      try{utterance?.onerror?.(new Event('error'))}catch{}
      cleanup()
    }
  }

  const cancel=()=>{
    requestId++
    cleanup()
    setStatus('NOA',500)
  }

  const localSpeak=(utterance:any)=>{void synthesize(utterance)}
  const localSynth={
    speak:localSpeak,
    cancel,
    getVoices:()=>[],
    pause:()=>audio?.pause(),
    resume:()=>{void audio?.play().catch(()=>{})},
    paused:false,
    pending:false,
    speaking:false,
  }

  const existing=(window as any).speechSynthesis
  let installed=false

  try{
    Object.defineProperty(window,'speechSynthesis',{
      configurable:true,
      enumerable:true,
      value:localSynth,
    })
    installed=(window as any).speechSynthesis===localSynth
  }catch{}

  if(!installed&&existing){
    try{
      const proto=Object.getPrototypeOf(existing)
      if(proto){
        Object.defineProperty(proto,'speak',{configurable:true,writable:true,value:localSpeak})
        Object.defineProperty(proto,'cancel',{configurable:true,writable:true,value:cancel})
        Object.defineProperty(proto,'getVoices',{configurable:true,writable:true,value:()=>[]})
      }
      installed=true
    }catch{}
  }

  if(!installed&&existing){
    try{existing.speak=localSpeak;existing.cancel=cancel;existing.getVoices=()=>[];installed=true}catch{}
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

  document.documentElement.setAttribute('data-noa-voice-build','20260930-2118')

  ;(window as any).__familiaNoaSpeakText=(text:string)=>{
    const Utterance=(window as any).SpeechSynthesisUtterance
    const utterance=Utterance?new Utterance(String(text||'')):{text:String(text||'')}
    return synthesize(utterance)
  }

  ;(window as any).__familiaNoaLocalTts={
    engine:'piper',
    voice:'es_MX-claude-high',
    build:'20260930-2118',
    installed,
    cancel,
    test:()=>{void (window as any).__familiaNoaSpeakText?.('Hola. Soy NOA.')},
  }

  if(installed){
    setStatus('Voz NOA lista',1200)
  }else{
    setStatus('Preparando motor de voz…',1800)
  }

  window.addEventListener('beforeunload',()=>{
    document.removeEventListener('pointerdown',primeAudio)
    cleanup()
  },{once:true})
}

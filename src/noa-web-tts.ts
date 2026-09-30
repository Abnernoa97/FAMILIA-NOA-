const nativeAndroid=/FAMILIA-NOA-Android/i.test(navigator.userAgent)
const nativeBridge=(window as any).FamiliaNoaNative
const hasNativeSpeak=!!nativeBridge&&typeof nativeBridge.speak==='function'

if(nativeAndroid&&!hasNativeSpeak){
  let audio:HTMLAudioElement|null=null
  let objectUrl=''
  let requestId=0
  let enginePromise:Promise<any>|null=null

  const setStatus=(value:string)=>{
    const label=document.querySelector<HTMLElement>('.noa-voice-label')
    if(label)label.textContent=value
  }

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
      const wav=await tts.predict({text:text.slice(0,900),voiceId:'es_MX-claude-high'})
      if(mine!==requestId)return
      objectUrl=URL.createObjectURL(wav)
      audio=new Audio(objectUrl)
      audio.preload='auto'
      audio.volume=1
      audio.playbackRate=.97
      audio.onplay=()=>{setStatus('NOA');try{utterance?.onstart?.(new Event('start'))}catch{}}
      audio.onended=()=>{setStatus('NOA');try{utterance?.onend?.(new Event('end'))}catch{};cleanup()}
      audio.onerror=()=>{setStatus('NOA');try{utterance?.onerror?.(new Event('error'))}catch{};cleanup()}
      await audio.play()
    }catch(error){
      console.warn('NOA local neural voice failed',error)
      setStatus('NOA')
      try{utterance?.onerror?.(new Event('error'))}catch{}
      cleanup()
    }
  }

  const cancel=()=>{
    requestId++
    cleanup()
    setStatus('NOA')
  }

  const localSpeak=(utterance:any)=>{void synthesize(utterance)}
  const existing=(window as any).speechSynthesis

  if(existing){
    try{existing.cancel=cancel}catch{}
    try{existing.speak=localSpeak}catch{}
    try{existing.getVoices=()=>[]}catch{}
  }else{
    try{
      Object.defineProperty(window,'speechSynthesis',{
        configurable:true,
        value:{speak:localSpeak,cancel,getVoices:()=>[],paused:false,pending:false,speaking:false}
      })
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

  ;(window as any).__familiaNoaLocalTts={
    engine:'piper',
    voice:'es_MX-claude-high',
    cancel,
  }
}

const synth=window.speechSynthesis

if(synth){
  const originalSpeak=synth.speak.bind(synth)
  let selected:SpeechSynthesisVoice|null=null

  const score=(voice:SpeechSynthesisVoice)=>{
    const name=(voice.name||'').toLowerCase()
    const lang=(voice.lang||'').toLowerCase()
    let value=0

    if(lang==='es-mx')value+=120
    else if(lang.startsWith('es-mx'))value+=110
    else if(lang==='es-us')value+=95
    else if(lang.startsWith('es'))value+=75
    else value-=200

    if(/natural|neural|premium|enhanced/.test(name))value+=55
    if(name.includes('google'))value+=40
    if(name.includes('samsung'))value+=35
    if(name.includes('microsoft'))value+=30
    if(/mexic|méxic/.test(name))value+=25
    if(/latin|latam|américa|america/.test(name))value+=18

    if(/espeak|pico|compact|basic|robot/.test(name))value-=100
    if(voice.localService)value+=5

    return value
  }

  const chooseVoice=()=>{
    const voices=synth.getVoices().filter(v=>(v.lang||'').toLowerCase().startsWith('es'))
    selected=voices.sort((a,b)=>score(b)-score(a))[0]||null
    return selected
  }

  const styleUtterance=(utterance:SpeechSynthesisUtterance)=>{
    if(!(utterance.lang||'').toLowerCase().startsWith('es'))return
    const voice=selected||chooseVoice()
    if(voice){
      utterance.voice=voice
      utterance.lang=voice.lang||'es-MX'
    }else{
      utterance.lang='es-MX'
    }
    utterance.rate=.92
    utterance.pitch=.98
    utterance.volume=1
  }

  chooseVoice()
  synth.addEventListener?.('voiceschanged',chooseVoice)

  ;(synth as any).speak=(utterance:SpeechSynthesisUtterance)=>{
    try{styleUtterance(utterance)}catch{}
    originalSpeak(utterance)
  }

  ;(window as any).__familiaNoaVoice={
    refresh:chooseVoice,
    current:()=>selected?{name:selected.name,lang:selected.lang}:null,
  }
}

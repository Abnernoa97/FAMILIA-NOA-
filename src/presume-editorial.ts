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
    const next=done?'Ya compartiste. Mira qué está haciendo la familia.':'Una foto real, sin preparar.'
    if(support.textContent!==next)support.textContent=next
  }

  const chips=[...challenge.querySelectorAll<HTMLElement>('.pres-chip')]
  if(chips[0]){
    const match=chips[0].textContent?.match(/(\d+)\s+de\s+(\d+)/i)
    if(match){
      const next=`${match[1]}/${match[2]} hoy`
      if(chips[0].textContent!==next)chips[0].textContent=next
    }
  }
  if(chips[1]){
    const match=chips[1].textContent?.match(/(\d+)\s+d[ií]a/i)
    if(match){
      const count=Number(match[1])||0
      const next=`${count} día${count===1?'':'s'} seguido${count===1?'':'s'}`
      if(chips[1].textContent!==next)chips[1].textContent=next
    }
  }

  if(main){
    const next=done?'Ver historias':'PRESUME'
    if(main.textContent!==next)main.textContent=next
  }
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

window.addEventListener('beforeunload',()=>observer.disconnect(),{once:true})

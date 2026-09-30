let observer:MutationObserver|null=null

const prompts=[
  ['Qué pasó hoy','¿Qué pasó hoy en la familia?'],
  ['Quién escribió','¿Quién escribió en el chat hoy?'],
  ['Qué dijeron','¿Qué dijeron hoy en el chat?'],
  ['Qué cambió','¿Qué hay nuevo o qué cambió hoy?'],
  ['Quién estuvo','¿Quién estuvo activo hoy?'],
  ['Fotos','¿Cuántas fotos se compartieron hoy?'],
  ['PRESUME','¿Quién ya hizo PRESUME hoy?'],
] as const

function enhance(){
  const modal=document.querySelector<HTMLElement>('.noa-modal')
  if(!modal||modal.dataset.noaPromptsV3==='1')return
  modal.dataset.noaPromptsV3='1'

  const hero=modal.querySelector<HTMLElement>('.noa-hero p')
  if(hero)hero.textContent='Pregúntame qué pasó hoy, quién escribió, qué dijeron o qué hizo alguien de la familia.'

  const input=modal.querySelector<HTMLInputElement>('[data-noa-input]')
  if(input)input.placeholder='Ej. ¿Qué hizo Mamá hoy?'

  const row=modal.querySelector<HTMLElement>('.noa-prompts')
  if(!row)return
  row.innerHTML=prompts.map(([label,question])=>`<button type="button" data-noa-quick-prompt="${encodeURIComponent(question)}">${label}</button>`).join('')
}

function onClick(event:Event){
  const target=(event.target as HTMLElement|null)?.closest<HTMLButtonElement>('[data-noa-quick-prompt]')
  if(!target)return
  const modal=target.closest<HTMLElement>('.noa-modal')
  if(!modal)return
  const input=modal.querySelector<HTMLInputElement>('[data-noa-input]')
  const form=modal.querySelector<HTMLFormElement>('[data-noa-form]')
  if(!input||!form)return
  const question=decodeURIComponent(target.dataset.noaQuickPrompt||'')
  if(!question)return
  input.value=question
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
}

document.addEventListener('click',onClick,true)
observer=new MutationObserver(enhance)
observer.observe(document.body,{childList:true,subtree:true})
window.addEventListener('beforeunload',()=>{observer?.disconnect();document.removeEventListener('click',onClick,true)},{once:true})
enhance()

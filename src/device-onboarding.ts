import { getIdentity, onIdentityChange } from './core/identity'
import { enablePasskeyForCurrentMember, getPasskeyStatus, passkeySupported } from './biometric-enhancer'
import { ensurePushSubscription, getPushSetupStatus } from './presume-challenge-push'

let busy=false
let queued=false
const nativeAndroid=typeof navigator!=='undefined'&&navigator.userAgent.includes('FAMILIA-NOA-Android/')

function injectStyles(){
  if(document.querySelector('#family-device-onboarding-css'))return
  const style=document.createElement('style')
  style.id='family-device-onboarding-css'
  style.textContent=`
  .device-onboarding{margin:0 0 18px;padding:15px;border:1px solid #e1dbd1;border-radius:20px;background:#fff;color:#171716;box-sizing:border-box}
  .device-onboarding-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:11px}.device-onboarding-head b{display:block;font:600 14px system-ui}.device-onboarding-head span{display:block;margin-top:3px;color:#8b857c;font:10px/1.35 system-ui}.device-onboarding-badge{flex:0 0 auto;padding:5px 8px;border-radius:999px;background:#f0ece4;color:#777169;font:700 8px system-ui;letter-spacing:.06em;text-transform:uppercase}
  .device-onboarding-list{display:grid;gap:7px}.device-onboarding-row{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:14px;background:#f7f4ee}.device-onboarding-icon{width:27px;height:27px;flex:0 0 27px;border-radius:50%;display:grid;place-items:center;background:#171716;color:#fff;font-size:12px}.device-onboarding-copy{min-width:0;flex:1}.device-onboarding-copy b{display:block;font:700 10px system-ui}.device-onboarding-copy span{display:block;margin-top:2px;color:#8b857c;font:9px/1.35 system-ui}.device-onboarding-action{border:0;border-radius:999px;background:#171716;color:#fff;padding:8px 10px;font:700 9px system-ui;white-space:nowrap;cursor:pointer}.device-onboarding-action:disabled{opacity:.5;cursor:wait}.device-onboarding-error{margin:8px 2px 0;color:#a04c43;font:9px/1.4 system-ui}
  .dark-mode .device-onboarding{background:#222220;border-color:#383732;color:#f5f5f2}.dark-mode .device-onboarding-row{background:#1b1b1a}.dark-mode .device-onboarding-action{background:#f5f5f2;color:#171716}
  `
  document.head.appendChild(style)
}

function removeLegacyButton(){document.querySelector('#enableBiometric')?.remove()}

async function render(){
  if(nativeAndroid){
    document.querySelector('[data-device-onboarding]')?.remove()
    removeLegacyButton()
    return
  }
  if(busy){queued=true;return}
  const root=document.querySelector<HTMLElement>('.shell')
  const identity=getIdentity()
  if(!root||!identity?.memberId){document.querySelector('[data-device-onboarding]')?.remove();return}
  busy=true
  try{
    removeLegacyButton()
    const [passkey,push]=await Promise.all([getPasskeyStatus(identity.memberId),getPushSetupStatus()])
    if(!document.querySelector('.shell')||getIdentity()?.memberId!==identity.memberId)return
    if(passkey.deviceReady&&push.ready){document.querySelector('[data-device-onboarding]')?.remove();return}

    let panel=document.querySelector<HTMLElement>('[data-device-onboarding]')
    if(!panel){
      panel=document.createElement('section')
      panel.className='device-onboarding'
      panel.dataset.deviceOnboarding='1'
      const hero=root.querySelector('.hero')
      if(hero)hero.insertAdjacentElement('afterend',panel)
      else root.prepend(panel)
    }

    const passkeyRow=passkey.deviceReady?''
      :passkeySupported()
        ?`<div class="device-onboarding-row"><i class="device-onboarding-icon">⌁</i><div class="device-onboarding-copy"><b>Huella / Face ID</b><span>Entra rápido desde este teléfono.</span></div><button type="button" class="device-onboarding-action" data-enable-passkey>Activar</button></div>`
        :`<div class="device-onboarding-row"><i class="device-onboarding-icon">⌁</i><div class="device-onboarding-copy"><b>Huella / Face ID</b><span>No disponible en este dispositivo.</span></div></div>`

    let pushRow=''
    if(!push.ready){
      if(push.needsInstall)pushRow=`<div class="device-onboarding-row"><i class="device-onboarding-icon">◉</i><div class="device-onboarding-copy"><b>Notificaciones</b><span>En iPhone, instala FAMILIA NOA en la pantalla de inicio primero.</span></div></div>`
      else if(!push.supported)pushRow=`<div class="device-onboarding-row"><i class="device-onboarding-icon">◉</i><div class="device-onboarding-copy"><b>Notificaciones</b><span>No disponibles en este navegador.</span></div></div>`
      else if(push.permission==='denied')pushRow=`<div class="device-onboarding-row"><i class="device-onboarding-icon">◉</i><div class="device-onboarding-copy"><b>Notificaciones</b><span>Están bloqueadas. Actívalas desde los ajustes del navegador o del teléfono.</span></div></div>`
      else pushRow=`<div class="device-onboarding-row"><i class="device-onboarding-icon">◉</i><div class="device-onboarding-copy"><b>Notificaciones</b><span>Recibe los avisos de PRESUME aunque cierres la app.</span></div><button type="button" class="device-onboarding-action" data-enable-push>Activar</button></div>`
    }

    panel.innerHTML=`<div class="device-onboarding-head"><div><b>Termina de preparar este teléfono</b><span>Solo falta activar lo que todavía no está listo.</span></div><span class="device-onboarding-badge">Privado</span></div><div class="device-onboarding-list">${passkeyRow}${pushRow}</div><div class="device-onboarding-error" data-device-error hidden></div>`

    panel.querySelector<HTMLButtonElement>('[data-enable-passkey]')?.addEventListener('click',async event=>{
      const button=event.currentTarget as HTMLButtonElement
      const error=panel?.querySelector<HTMLElement>('[data-device-error]')
      button.disabled=true
      if(error){error.hidden=true;error.textContent=''}
      try{await enablePasskeyForCurrentMember();await render()}
      catch(err){
        const name=err instanceof Error?err.name:''
        if(name!=='NotAllowedError'&&name!=='AbortError'&&error){error.hidden=false;error.textContent=err instanceof Error?err.message:'No se pudo activar la biometría.'}
        button.disabled=false
      }
    })

    panel.querySelector<HTMLButtonElement>('[data-enable-push]')?.addEventListener('click',async event=>{
      const button=event.currentTarget as HTMLButtonElement
      const error=panel?.querySelector<HTMLElement>('[data-device-error]')
      button.disabled=true
      if(error){error.hidden=true;error.textContent=''}
      try{
        const ok=await ensurePushSubscription(true)
        if(!ok){const status=await getPushSetupStatus();if(status.permission==='denied'&&error){error.hidden=false;error.textContent='Las notificaciones están bloqueadas en este dispositivo.'}}
        await render()
      }catch(err){if(error){error.hidden=false;error.textContent=err instanceof Error?err.message:'No se pudieron activar las notificaciones.'};button.disabled=false}
    })
  }finally{
    busy=false
    if(queued){queued=false;void render()}
  }
}

injectStyles()
const stopIdentityWatch=onIdentityChange(()=>void render())
document.addEventListener('family:home-rendered',()=>void render())
document.addEventListener('family:passkey-changed',()=>void render())
document.addEventListener('family:push-changed',()=>void render())
const app=document.querySelector('#app')
const appObserver=app?new MutationObserver(()=>{if(document.querySelector('.shell'))void render()}):null
if(app&&appObserver)appObserver.observe(app,{childList:true})
void render()
window.addEventListener('beforeunload',()=>{stopIdentityWatch();appObserver?.disconnect()},{once:true})

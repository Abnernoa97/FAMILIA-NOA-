import { getIdentity } from './core/identity'
import { isLocationLive, subscribeLocationState, type LocationState } from './core/location-store'

type NativeState={ok?:boolean;status?:string;active?:boolean;endsAt?:number}
type NativeBridge={getLiveLocationState?:()=>string;startLiveLocation?:(minutes:number)=>string;stopLiveLocation?:()=>string}
let state:LocationState|null=null
let nativeState:NativeState|null=null
let busy=false

function bridge():NativeBridge|null{
  const value=(window as any).FamiliaNoaNative as NativeBridge|undefined
  return value&&typeof value.startLiveLocation==='function'&&typeof value.stopLiveLocation==='function'?value:null
}
function parse(value:unknown):NativeState|null{try{return typeof value==='string'?JSON.parse(value):value as NativeState}catch{return null}}
function readNative(){const b=bridge();if(!b?.getLiveLocationState)return null;try{nativeState=parse(b.getLiveLocationState());return nativeState}catch{return null}}
function own(){const id=getIdentity()?.memberId;return id&&state?state.locations.find(item=>item.member_id===id)||null:null}
function active(){const mine=own();return !!nativeState?.active||!!mine&&isLocationLive(mine)}
function remaining(){
  const ownRow=own();const end=nativeState?.active&&Number(nativeState.endsAt)>0?Number(nativeState.endsAt):ownRow?.live_until?new Date(ownRow.live_until).getTime():0
  if(!end)return 'Hasta que la apagues'
  const min=Math.max(1,Math.ceil((end-Date.now())/60000));return min>=60?'1 h restante':`${min} min restantes`
}

function ensureCss(){
  if(document.querySelector('#location-live-css'))return
  const style=document.createElement('style');style.id='location-live-css'
  style.textContent=`.location-live-open{width:100%;margin-top:10px;padding:14px;border:1px solid #171716;border-radius:16px;background:#fff;color:#171716;font-weight:750}.location-live-options{display:flex;gap:6px;margin-top:8px}.location-live-options button{flex:1;padding:10px 5px;border-radius:13px;background:#eee9e0;color:#171716;font-size:9px;font-weight:750}.location-live-active{margin-top:10px;padding:13px;border-radius:17px;background:#171716;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px}.location-live-active small{display:block;color:#8fca9f;font-size:8px;font-weight:800;letter-spacing:.12em}.location-live-active b{display:block;margin-top:3px;font:500 16px var(--display-font,Georgia,serif)}.location-live-active span{display:block;margin-top:3px;color:#bbb7af;font-size:9px}.location-live-stop{padding:9px 11px;border-radius:999px;background:#f5f2eb;color:#171716;font-size:9px;font-weight:800}`
  document.head.appendChild(style)
}

function render(){
  const page=document.querySelector<HTMLElement>('.location-page');const b=bridge()
  if(!page||!b||!page.querySelector('#back'))return
  const box=page.querySelector<HTMLElement>('.locationbox');const primary=page.querySelector<HTMLButtonElement>('#sharelocation')
  if(!box||!primary)return
  const live=active()
  const mode=live?'active':'idle'
  let root=box.querySelector<HTMLElement>('[data-live-root]')
  if(root?.dataset.mode===mode){
    primary.hidden=live
    if(live){
      const label=root.querySelector<HTMLElement>('[data-live-remaining]')
      if(label)label.textContent=remaining()
    }
    return
  }
  root?.remove()
  root=document.createElement('div');root.dataset.liveRoot='1';root.dataset.mode=mode
  if(live){
    primary.hidden=true
    root.className='location-live-active'
    root.innerHTML=`<div><small>UBICACIÓN EN VIVO</small><b>Compartiendo con la familia</b><span data-live-remaining>${remaining()}</span></div><button type="button" class="location-live-stop" data-live-stop>Detener</button>`
    root.querySelector('[data-live-stop]')?.addEventListener('click',stopLive)
  }else{
    primary.hidden=false
    root.innerHTML='<button type="button" class="location-live-open" data-live-open>Compartir ubicación en vivo</button><div class="location-live-options" data-live-options hidden><button data-min="15">15 min</button><button data-min="60">1 hora</button><button data-min="0">Hasta apagar</button></div>'
    root.querySelector('[data-live-open]')?.addEventListener('click',()=>{const options=root?.querySelector<HTMLElement>('[data-live-options]');if(options)options.hidden=!options.hidden})
    root.querySelectorAll<HTMLButtonElement>('[data-min]').forEach(button=>button.addEventListener('click',()=>startLive(Number(button.dataset.min||15))))
  }
  box.appendChild(root)
}

function startLive(minutes:number){
  const b=bridge();if(!b||busy)return;busy=true
  try{const result=parse(b.startLiveLocation?.(minutes));if(result?.status==='permission-required')return;nativeState={active:true,status:'starting',endsAt:minutes>0?Date.now()+minutes*60000:0};render()}
  catch(error){console.error('Live location start failed',error)}finally{busy=false}
}
function stopLive(){
  const b=bridge();if(!b||busy)return;busy=true
  try{b.stopLiveLocation?.();nativeState={active:false,status:'stopping',endsAt:0};render();setTimeout(()=>{readNative();render()},900)}
  catch(error){console.error('Live location stop failed',error)}finally{busy=false}
}
function scan(){if(!document.querySelector('.location-page')||!bridge())return;readNative();render()}

ensureCss()
const unsubscribe=subscribeLocationState(next=>{state=next;render()})
const observer=new MutationObserver(scan);observer.observe(document.body,{childList:true,subtree:true})
window.addEventListener('familia-noa:live-location-native',event=>{nativeState=(event as CustomEvent<NativeState>).detail||readNative();render()})
const clock=window.setInterval(()=>{if(document.querySelector('.location-page')){readNative();render()}},15_000)
window.addEventListener('beforeunload',()=>{observer.disconnect();unsubscribe();clearInterval(clock)},{once:true})
scan()
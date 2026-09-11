import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { supabase } from './supabase'

const KEY='familia-noa-member', PROFILE_KEY='familia-noa-profile'
const PASSKEY_KEY='familia-noa-passkey-member'
const PASSKEY_CRED_KEY='familia-noa-passkey-credential-id'
const PASSKEY_MEMBER_KEY='familia-noa-passkey-member-id'
const BYPASS_KEY='familia-noa-biometric-bypass'
const AUTHENTICATED_KEY='familia-noa-biometric-authenticated'
const supported=()=>typeof window!=='undefined'&&!!window.PublicKeyCredential&&window.isSecureContext

async function call(action:string,payload:Record<string,unknown>={}){const {data,error}=await supabase.functions.invoke('family-passkeys-v2',{body:{action,...payload}});if(error)throw new Error(error.message||'No se pudo completar la operación.');if(data?.error)throw new Error(data.error);return data}
function session(p:{id:string;name:string}){localStorage.setItem(KEY,p.name);sessionStorage.setItem(PROFILE_KEY,JSON.stringify(p));sessionStorage.setItem(AUTHENTICATED_KEY,'1');location.reload()}

function biometricScreen(){
 const app=document.querySelector<HTMLDivElement>('#app');if(!app)return
 app.innerHTML='<main class="login biometric-first"><div class="brand"><span>FAMILIA</span><strong>NOA</strong></div><p class="eyebrow">ACCESO SEGURO</p><h1>Bienvenido de nuevo</h1><p class="intro">Entra con tu huella o Face ID.</p><div class="biometric-access biometric-first-access"><button id="biometricLogin" class="primary biometric-button" type="button">🔐 Entrar con huella / Face ID</button><div id="biometricError" aria-live="polite"></div><button id="profileLogin" class="biometric-profile-link" type="button">Entrar con mi perfil</button></div></main>'
 const b=app.querySelector<HTMLButtonElement>('#biometricLogin')!,e=app.querySelector<HTMLElement>('#biometricError')!
 b.onclick=()=>biometric(b,e)
 app.querySelector<HTMLButtonElement>('#profileLogin')!.onclick=()=>{sessionStorage.setItem(BYPASS_KEY,'1');location.reload()}
 return {b,e}
}

async function biometric(button:HTMLButtonElement,error:HTMLElement){button.disabled=true;error.textContent='Verificando…';try{const memberId=localStorage.getItem(PASSKEY_MEMBER_KEY)||undefined;const credentialId=localStorage.getItem(PASSKEY_CRED_KEY)||undefined;const payload:Record<string,unknown>={};if(memberId)payload.member_id=memberId;if(credentialId)payload.credential_ids=[credentialId];const {token,options}=await call('auth-options',payload);const response=await startAuthentication({optionsJSON:options});const r=await call('auth-verify',{token,response});if(!r?.profile?.id)throw new Error('No se pudo identificar el perfil.');localStorage.setItem(PASSKEY_KEY,'enabled');localStorage.setItem(PASSKEY_MEMBER_KEY,r.profile.id);localStorage.setItem(PASSKEY_CRED_KEY,response.id);session(r.profile)}catch(e){if((e as Error).name!=='NotAllowedError'&&(e as Error).name!=='AbortError')error.textContent=e instanceof Error?e.message:'No se pudo entrar.';button.disabled=false}}

async function autoBiometric(){
 if(!supported()||sessionStorage.getItem(AUTHENTICATED_KEY)==='1'||sessionStorage.getItem(BYPASS_KEY)==='1')return
 const credentialId=localStorage.getItem(PASSKEY_CRED_KEY)
 const memberId=localStorage.getItem(PASSKEY_MEMBER_KEY)
 if(!credentialId&&!memberId)return
 sessionStorage.removeItem(BYPASS_KEY)
 localStorage.removeItem(KEY);sessionStorage.removeItem(PROFILE_KEY)
 const controls=biometricScreen();if(!controls)return
 setTimeout(()=>void biometric(controls.b,controls.e),180)
}

function addLogin(){if(!supported())return;const members=document.querySelector('.members');if(!members||document.querySelector('#biometricLogin'))return;const w=document.createElement('div');w.className='biometric-access';w.innerHTML='<button id="biometricLogin" class="primary biometric-button" type="button">🔐 Entrar con huella / Face ID</button><div id="biometricError" aria-live="polite"></div><div class="biometric-divider"><span>o entra con tu perfil</span></div>';members.before(w);const b=w.querySelector<HTMLButtonElement>('#biometricLogin')!,e=w.querySelector<HTMLElement>('#biometricError')!;b.onclick=()=>biometric(b,e)}

async function hasPasskey(memberId:string){try{const r=await call('passkey-status',{member_id:memberId});return {has:!!r?.hasPasskey,ids:Array.isArray(r?.credential_ids)?r.credential_ids.filter((x:any)=>typeof x==='string'):[]}}catch{return {has:false,ids:[]}}}

async function register(memberId:string,house:string,nickname:string){try{const status=await hasPasskey(memberId);if(status.has){localStorage.setItem(PASSKEY_KEY,'enabled');localStorage.setItem(PASSKEY_MEMBER_KEY,memberId);if(status.ids[0])localStorage.setItem(PASSKEY_CRED_KEY,status.ids[0]);alert('Este perfil ya tiene una huella o Face ID registrado. No es necesario registrarlo de nuevo.');location.reload();return}const {token,options}=await call('register-options',{member_id:memberId,house_number:house,nickname});const response=await startRegistration({optionsJSON:options});const result=await call('register-verify',{token,response});localStorage.setItem(PASSKEY_KEY,'enabled');localStorage.setItem(PASSKEY_MEMBER_KEY,memberId);if(result?.credential_id)localStorage.setItem(PASSKEY_CRED_KEY,result.credential_id);alert('Listo. Este teléfono ya puede entrar con huella o reconocimiento facial.');sessionStorage.removeItem(AUTHENTICATED_KEY);location.reload()}catch(e){if((e as Error).name!=='NotAllowedError'&&(e as Error).name!=='AbortError')alert(e instanceof Error?e.message:'No se pudo activar la biometría.')}}

async function addSetup(){if(!supported())return;const home=document.querySelector('.shell'),change=document.querySelector('#change');if(!home||!change||document.querySelector('#enableBiometric'))return;const raw=sessionStorage.getItem(PROFILE_KEY);if(!raw)return;const p=JSON.parse(raw) as {id:string;name:string};const status=await hasPasskey(p.id);if(status.has){localStorage.setItem(PASSKEY_KEY,'enabled');localStorage.setItem(PASSKEY_MEMBER_KEY,p.id);if(status.ids[0])localStorage.setItem(PASSKEY_CRED_KEY,status.ids[0]);return}const b=document.createElement('button');b.id='enableBiometric';b.className='biometric-setup';b.textContent='🔐 Activar huella / Face ID';change.parentElement?.after(b);b.onclick=async()=>{const house=prompt('Confirma el número de la casa.');if(!house)return;const nickname=prompt(`Confirma tu apodo familiar, ${p.name}.`);if(nickname)await register(p.id,house,nickname)}}

void autoBiometric()
const observer=new MutationObserver(()=>{addLogin();void addSetup()});observer.observe(document.body,{childList:true,subtree:true});addLogin();void addSetup()

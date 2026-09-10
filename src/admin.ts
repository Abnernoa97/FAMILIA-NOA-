import './admin.css'
import { supabase } from './supabase'

type Member={id:string,name:string,active:boolean}
const root=document.querySelector<HTMLDivElement>('#admin-app')!
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]!))
let members:Member[]=[]

function login(error=''){
  root.innerHTML=`<main class="admin-login"><div class="mark">FAMILIA <b>NOA</b></div><p>ADMIN</p><h1>Control de la familia.</h1><form id="login"><input id="email" type="email" placeholder="Email" autocomplete="email" required><input id="password" type="password" placeholder="Contraseña" autocomplete="current-password" required><button>Entrar</button></form>${error?`<div class="error">${esc(error)}</div>`:''}</main>`
  document.querySelector('#login')!.addEventListener('submit',async e=>{e.preventDefault();const email=(document.querySelector<HTMLInputElement>('#email')!).value;const password=(document.querySelector<HTMLInputElement>('#password')!).value;const {error}=await supabase.auth.signInWithPassword({email,password});if(error){login('No se pudo iniciar sesión.');return}await boot()})
}

async function boot(){
  const {data:{user}}=await supabase.auth.getUser()
  if(!user){login();return}
  const {data:admin}=await supabase.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle()
  if(!admin){await supabase.auth.signOut();login('Esta cuenta no tiene permisos de administrador.');return}
  render()
}

async function load(){
  const [m,s]=await Promise.all([
    supabase.from('family_members').select('id,name,active').order('created_at'),
    supabase.from('app_settings').select('settings').eq('id','global').maybeSingle()
  ])
  members=(m.data||[]) as Member[]
  return s.data?.settings||{}
}

async function hash(v:string){const data=new TextEncoder().encode(v.trim().toLowerCase());const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}

async function render(){
  const settings=await load()
  root.innerHTML=`<main class="admin-shell"><header><div><p class="kicker">FAMILIA NOA</p><h1>ADMIN</h1></div><button id="logout">Salir</button></header><section class="admin-hero"><p>CONTROL CENTRAL</p><h2>La familia, a tu manera.</h2><span>Los cambios visuales se reflejan en la app familiar en tiempo real.</span></section><section class="panel"><div class="panel-title"><div><p class="kicker">APARIENCIA</p><h3>Identidad visual</h3></div><button id="saveVisual">Guardar</button></div><div class="fields"><label>Tipografía<select id="font"><option value="serif">Editorial</option><option value="sans">Sans</option><option value="mono">Mono</option></select></label><label>Fondo<input id="background" type="color"></label><label>Superficie<input id="surface" type="color"></label><label>Texto<input id="ink" type="color"></label><label>Acento<input id="accent" type="color"></label><label>Título principal<input id="heroTitle" maxlength="100"></label><label class="wide">Mensaje principal<input id="heroText" maxlength="180"></label></div></section><section class="panel"><div class="panel-title"><div><p class="kicker">FAMILIA</p><h3>Miembros y acceso</h3></div></div><div id="members"></div><form id="addMember" class="add"><input id="newName" placeholder="Nuevo nombre"><button>Agregar</button></form></section><section class="panel"><div class="panel-title"><div><p class="kicker">SEGURIDAD</p><h3>Acceso familiar</h3></div></div><p class="hint">Cada persona tendrá su nombre, número de casa de Trinidad y apodo. Las credenciales se guardan como hashes, nunca en texto visible.</p><div id="access"></div></section><div id="toast"></div></main>`
  ;(['font','background','surface','ink','accent','heroTitle','heroText'] as const).forEach(k=>{const el=document.querySelector<HTMLInputElement|HTMLSelectElement>('#'+k)!;if(settings[k]!=null)el.value=settings[k]})
  renderMembers()
  document.querySelector('#logout')!.addEventListener('click',async()=>{await supabase.auth.signOut();login()})
  document.querySelector('#saveVisual')!.addEventListener('click',saveVisual)
  document.querySelector('#addMember')!.addEventListener('submit',addMember)
}

function renderMembers(){
  const el=document.querySelector('#members')!
  el.innerHTML=members.map(m=>`<div class="member-row"><div><b>${esc(m.name)}</b><small>${m.active?'Activo':'Desactivado'}</small></div><button data-toggle="${m.id}">${m.active?'Desactivar':'Activar'}</button></div>`).join('')
  el.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b=>b.addEventListener('click',async()=>{const m=members.find(x=>x.id===b.dataset.toggle)!;await supabase.from('family_members').update({active:!m.active}).eq('id',m.id);await render()}))
}

async function renderAccess(){
  const el=document.querySelector('#access');if(!el)return
  const {data}=await supabase.from('family_access').select('member_id,must_share_location').order('updated_at')
  const rows=data||[]
  el.innerHTML=members.map(m=>{const a=rows.find(x=>x.member_id===m.id);return `<div class="access-row"><div><b>${esc(m.name)}</b><small>${a?.must_share_location?'Ubicación obligatoria':'Ubicación voluntaria'}</small></div><div class="access-actions"><button data-cred="${m.id}">Definir acceso</button><button data-gps="${m.id}">${a?.must_share_location?'GPS obligatorio':'GPS voluntario'}</button></div></div>`}).join('')
  el.querySelectorAll<HTMLButtonElement>('[data-cred]').forEach(b=>b.addEventListener('click',()=>credentialSheet(b.dataset.cred!)))
  el.querySelectorAll<HTMLButtonElement>('[data-gps]').forEach(b=>b.addEventListener('click',async()=>{const m=rows.find(x=>x.member_id===b.dataset.gps);await supabase.from('family_access').update({must_share_location:!m?.must_share_location,updated_at:new Date().toISOString()}).eq('member_id',b.dataset.gps);renderAccess()}))
}

async function credentialSheet(memberId:string){
  const m=members.find(x=>x.id===memberId)!;const el=document.createElement('div');el.className='modal';el.innerHTML=`<div class="modal-card"><button class="x">×</button><p class="kicker">${esc(m.name)}</p><h3>Definir acceso</h3><label>Número de casa de Trinidad<input id="house" inputmode="numeric"></label><label>Apodo familiar<input id="nick"></label><button class="save" id="save">Guardar acceso</button></div>`;document.body.appendChild(el);el.querySelector('.x')!.addEventListener('click',()=>el.remove());el.querySelector('#save')!.addEventListener('click',async()=>{const house=(el.querySelector<HTMLInputElement>('#house')!).value;const nick=(el.querySelector<HTMLInputElement>('#nick')!).value;if(!house||!nick)return;const [houseHash,nickHash]=await Promise.all([hash(house),hash(nick)]);await supabase.from('family_access').upsert({member_id:memberId,house_code_hash:houseHash,nickname_hash:nickHash,updated_at:new Date().toISOString()});el.remove();toast('Acceso actualizado')})
}

async function saveVisual(){const settings={font:(document.querySelector('#font') as HTMLSelectElement).value,background:(document.querySelector('#background') as HTMLInputElement).value,surface:(document.querySelector('#surface') as HTMLInputElement).value,ink:(document.querySelector('#ink') as HTMLInputElement).value,accent:(document.querySelector('#accent') as HTMLInputElement).value,heroTitle:(document.querySelector('#heroTitle') as HTMLInputElement).value,heroText:(document.querySelector('#heroText') as HTMLInputElement).value};const {error}=await supabase.from('app_settings').upsert({id:'global',settings,updated_at:new Date().toISOString()});toast(error?'No se pudo guardar':'Cambios publicados')}
async function addMember(e:Event){e.preventDefault();const input=document.querySelector<HTMLInputElement>('#newName')!;const name=input.value.trim();if(!name)return;const {error}=await supabase.from('family_members').insert({name,active:true});if(!error){input.value='';await render();toast('Miembro agregado')}}
function toast(text:string){const t=document.querySelector('#toast')!;t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}

supabase.auth.onAuthStateChange((_event,session)=>{if(!session) login()})
boot()

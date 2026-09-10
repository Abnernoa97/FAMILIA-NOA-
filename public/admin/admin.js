import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = 'https://ldtfzvvmjsarkxrchrqx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_r3apEbRySSbhOSyx9URW7A_8aQDV5dN'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const app = document.querySelector('#app')
let settings = {}

const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))

function login(message='') {
  app.innerHTML = `<main class="auth"><div class="brand"><span>FAMILIA</span><strong>NOA</strong></div><p class="eyebrow">PRIVATE CONTROL ROOM</p><h1>Administrador</h1><p>Gestiona la experiencia de FAMILIA NOA desde aquí.</p>${message?`<div class="error">${esc(message)}</div>`:''}<form id="login"><input id="email" type="email" autocomplete="email" placeholder="Correo del administrador" required><input id="password" type="password" autocomplete="current-password" placeholder="Contraseña" required><button>Entrar</button></form><small>El acceso real está protegido por Supabase Auth.</small></main>`
  document.querySelector('#login').onsubmit = async e => { e.preventDefault(); const email=document.querySelector('#email').value.trim(); const password=document.querySelector('#password').value; const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) login('No se pudo iniciar sesión.'); else render() }
}

async function load() { const {data}=await supabase.from('app_settings').select('settings').eq('id','global').single(); settings=data?.settings||{}; }

function render() {
  app.innerHTML = `<main class="admin"><header><div><p class="eyebrow">FAMILIA NOA</p><h1>ADMIN</h1></div><button id="logout" class="ghost">Salir</button></header><section class="intro"><p class="eyebrow">CONTROL ROOM</p><h2>La familia, a tu manera.</h2><p>Cambia la identidad visual y los contenidos sin tocar la aplicación familiar.</p></section><section class="panel"><div class="panelhead"><div><span class="kicker">APARIENCIA</span><h3>Dirección visual</h3></div><span class="live">LIVE</span></div><label>Tipografía<select id="font"><option>Inter</option><option>DM Sans</option><option>Manrope</option><option>Playfair Display</option><option>Space Grotesk</option></select></label><div class="colors"><label>Fondo<input id="background" type="color" value="${esc(settings.background||'#F5F2EB')}"></label><label>Superficie<input id="surface" type="color" value="${esc(settings.surface||'#FFFFFF')}"></label><label>Texto<input id="ink" type="color" value="${esc(settings.ink||'#171716')}"></label><label>Acento<input id="accent" type="color" value="${esc(settings.accent||'#171716')}"></label></div><label>Título principal<input id="heroTitle" value="${esc(settings.heroTitle||'¿Cómo está la familia hoy?')}"></label><label>Texto principal<textarea id="heroText">${esc(settings.heroText||'Habla, comparte y revisa que todos estén bien.')}</textarea></label><button class="save" id="save">Guardar cambios</button><p id="status" class="status"></p></section><section class="cards"><button><b>👥 Familia</b><span>Miembros y accesos</span></button><button><b>📸 Fotos</b><span>Álbum y fondos visuales</span></button><button><b>📍 Ubicación</b><span>Permisos y seguimiento</span></button><button><b>🚨 Alertas</b><span>Ayuda y estados</span></button></section></main>`
  document.querySelector('#font').value=settings.font||'Inter'
  document.querySelector('#logout').onclick=async()=>{await supabase.auth.signOut();login()}
  document.querySelector('#save').onclick=save
}

async function save(){
  const next={...settings,font:document.querySelector('#font').value,background:document.querySelector('#background').value,surface:document.querySelector('#surface').value,ink:document.querySelector('#ink').value,accent:document.querySelector('#accent').value,heroTitle:document.querySelector('#heroTitle').value.trim(),heroText:document.querySelector('#heroText').value.trim()}
  const {error}=await supabase.from('app_settings').update({settings:next,updated_at:new Date().toISOString()}).eq('id','global')
  const status=document.querySelector('#status'); status.textContent=error?'No guardado. Revisa que tu usuario tenga permisos de administrador.':'Guardado. La app familiar recibirá el cambio en tiempo real.'; if(!error) settings=next
}

supabase.auth.onAuthStateChange(async (_event, session)=>{ if(session){await load();render()} else login() })

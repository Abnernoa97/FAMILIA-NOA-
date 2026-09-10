const members = ['Mamá', 'Papá', 'Romel', 'Osniel', 'Abner']
const key = 'familia-noa-member'
let member = localStorage.getItem(key) || ''

const app = document.querySelector<HTMLDivElement>('#app')!

document.title = 'FAMILIA NOA'

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <div class="brand"><span>FAMILIA</span><strong>NOA</strong></div>
      <p class="eyebrow">PRIVATE FAMILY SPACE</p>
      <h1>¿Quién eres?</h1>
      <p class="intro">Un espacio para estar cerca, estés donde estés.</p>
      <div class="members">${members.map(m => `<button class="member" data-member="${m}">${m}<span>›</span></button>`).join('')}</div>
    </main>`
  document.querySelectorAll<HTMLButtonElement>('[data-member]').forEach(btn => btn.onclick = () => {
    member = btn.dataset.member!
    localStorage.setItem(key, member)
    renderHome()
  })
}

function renderHome() {
  app.innerHTML = `
    <main class="shell">
      <header class="top"><div><p class="eyebrow">FAMILIA NOA</p><h1>Hola, ${member} <span>♡</span></h1></div><button class="avatar" id="change">${member.charAt(0)}</button></header>
      <section class="hero"><p class="eyebrow">TODOS CERCA</p><h2>¿Cómo está la familia hoy?</h2><p>Un solo lugar para hablar, compartir y saber que estamos bien.</p></section>
      <section class="grid">
        <button class="card dark" id="chat"><i>✦</i><b>Chat</b><small>Habla con todos</small></button>
        <button class="card photo" id="photos"><i>◌</i><b>Fotos</b><small>Momentos de familia</small></button>
        <button class="card" id="location"><i>⌖</i><b>Ubicación</b><small>Ver dónde estamos</small></button>
        <button class="card ok" id="ok"><i>♥</i><b>Estoy bien</b><small>Avísale a la familia</small></button>
        <button class="card help" id="help"><i>!</i><b>Ayuda</b><small>Necesito a mi familia</small></button>
      </section>
      <nav><button class="active">Inicio</button><button id="navchat">Chat</button><button id="navphotos">Fotos</button><button id="navlocation">Ubicación</button></nav>
    </main>`
  document.querySelector('#change')!.addEventListener('click', renderLogin)
  document.querySelector('#chat')!.addEventListener('click', () => sheet('Chat', 'El chat familiar se conectará aquí con Supabase Realtime.'))
  document.querySelector('#photos')!.addEventListener('click', () => sheet('Fotos', 'Aquí vivirá el álbum privado de la familia.'))
  document.querySelector('#location')!.addEventListener('click', getLocation)
  document.querySelector('#ok')!.addEventListener('click', () => sheet('Estoy bien ❤️', 'Tu estado quedará marcado para la familia cuando conectemos el backend.'))
  document.querySelector('#help')!.addEventListener('click', () => sheet('Ayuda', 'Se preparará una alerta familiar inmediata.'))
}

function sheet(title: string, text: string) {
  const el = document.createElement('div')
  el.className = 'overlay'
  el.innerHTML = `<div class="sheet"><button class="close">×</button><p class="eyebrow">FAMILIA NOA</p><h2>${title}</h2><p>${text}</p><button class="primary close">Entendido</button></div>`
  document.body.appendChild(el)
  el.querySelectorAll('.close').forEach(x => x.addEventListener('click', () => el.remove()))
}

function getLocation() {
  if (!navigator.geolocation) return sheet('Ubicación', 'Este dispositivo no permite compartir ubicación.')
  navigator.geolocation.getCurrentPosition(
    p => sheet('Ubicación activa', `Precisión aproximada: ${Math.round(p.coords.accuracy)} m. La ubicación se conectará al mapa familiar en la siguiente etapa.`),
    () => sheet('Ubicación', 'Necesitamos permiso para acceder a tu ubicación.')
  )
}

if (member && members.includes(member)) renderHome()
else renderLogin()

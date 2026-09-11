import { supabase } from './supabase'

const KEY = 'familia-noa-member'
const PROFILE_KEY = 'familia-noa-profile'
let boundForm: HTMLFormElement | null = null
let busy = false

function bindLoginForm() {
  const form = document.querySelector<HTMLFormElement>('#security')
  if (!form || boundForm === form) return
  boundForm = form
  form.addEventListener('submit', async event => {
    if (busy) return
    event.preventDefault()
    event.stopImmediatePropagation()
    busy = true
    const name = document.querySelector<HTMLElement>('.login h1')?.textContent?.trim() || ''
    const house = document.querySelector<HTMLInputElement>('#house')?.value.trim() || ''
    const nickname = document.querySelector<HTMLInputElement>('#nickname')?.value.trim() || ''
    const error = document.querySelector<HTMLElement>('#securityError')
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (error) error.textContent = 'Verificando…'
    if (button) button.disabled = true
    try {
      const { data: member, error: memberError } = await supabase.from('family_members').select('id,name,active').eq('name', name).eq('active', true).maybeSingle()
      if (memberError || !member) throw new Error('No se pudo encontrar este perfil.')
      const { data, error: rpcError } = await supabase.rpc('login_by_family_credentials', { p_member_id: member.id, p_house_number: house, p_nickname: nickname })
      if (rpcError) throw new Error('No se pudo verificar el acceso. Inténtalo de nuevo.')
      if (!data?.length) throw new Error('Datos incorrectos. Comprueba el número 6499 y tu apodo.')
      const profile = data[0] as { id: string; name: string }
      localStorage.setItem(KEY, profile.name)
      sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
      window.location.reload()
    } catch (err) {
      if (error) error.textContent = err instanceof Error ? err.message : 'No se pudo entrar. Inténtalo de nuevo.'
      if (button) button.disabled = false
      busy = false
    }
  }, true)
}

// #change is the profile/avatar control after login. Only clear the session
// when #change is being used from the login screen itself.
document.addEventListener('click', event => {
  const target = event.target as HTMLElement | null
  if (!target?.closest('#change')) return
  const loggedIn = !!localStorage.getItem(KEY) && !!sessionStorage.getItem(PROFILE_KEY)
  const loginScreen = !!document.querySelector('#security')
  if (loggedIn && !loginScreen) return
  event.preventDefault()
  event.stopImmediatePropagation()
  localStorage.removeItem(KEY)
  sessionStorage.removeItem(PROFILE_KEY)
  window.location.reload()
}, true)

const observer = new MutationObserver(bindLoginForm)
observer.observe(document.body, { childList: true, subtree: true })
bindLoginForm()

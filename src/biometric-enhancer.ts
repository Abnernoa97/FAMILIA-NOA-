import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { supabase } from './supabase'

const KEY = 'familia-noa-member'
const PROFILE_KEY = 'familia-noa-profile'
const PASSKEY_KEY = 'familia-noa-passkey'
const PASSKEY_CRED_KEY = 'familia-noa-passkey-credential-id'
const PASSKEY_MEMBER_KEY = 'familia-noa-passkey-member-id'
const AUTHENTICATED_KEY = 'familia-noa-biometric-authenticated'
const supported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('family-passkeys-v2', { body: { action, ...payload } })
  if (error) throw new Error(error.message || 'No se pudo completar la operación.')
  if (data?.error) throw new Error(data.error)
  return data
}

function session(profile: { id: string; name: string }) {
  localStorage.setItem(KEY, profile.name)
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  sessionStorage.setItem(AUTHENTICATED_KEY, '1')
  window.location.reload()
}

async function biometric(button: HTMLButtonElement, error: HTMLElement) {
  if (button.disabled) return
  button.disabled = true
  error.textContent = 'Verificando…'
  try {
    const memberId = localStorage.getItem(PASSKEY_MEMBER_KEY) || undefined
    const credentialId = localStorage.getItem(PASSKEY_CRED_KEY) || undefined
    const payload: Record<string, unknown> = {}
    if (memberId) payload.member_id = memberId
    if (credentialId) payload.credential_ids = [credentialId]
    const optionsResult = await call('auth-options', payload)
    const response = await Promise.race([
      startAuthentication({ optionsJSON: optionsResult.options }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('La verificación tardó demasiado. Puedes entrar con tu perfil.')), 8000))
    ])
    const result = await call('auth-verify', { token: optionsResult.token, response })
    if (!result?.profile?.id) throw new Error('No se pudo identificar el perfil.')
    localStorage.setItem(PASSKEY_KEY, 'enabled')
    localStorage.setItem(PASSKEY_MEMBER_KEY, result.profile.id)
    localStorage.setItem(PASSKEY_CRED_KEY, response.id)
    session(result.profile)
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name !== 'NotAllowedError' && name !== 'AbortError') error.textContent = err instanceof Error ? err.message : 'No se pudo entrar.'
    button.disabled = false
  }
}

function addLogin() {
  if (!supported()) return
  const members = document.querySelector('.members')
  if (!members || document.querySelector('#biometricLogin')) return
  const wrapper = document.createElement('div')
  wrapper.className = 'biometric-access'
  wrapper.innerHTML = '<button id="biometricLogin" class="primary biometric-button" type="button">🔐 Entrar con huella / Face ID</button><div id="biometricError" aria-live="polite"></div><div class="biometric-divider"><span>o entra con tu perfil</span></div>'
  members.before(wrapper)
  const button = wrapper.querySelector<HTMLButtonElement>('#biometricLogin')!
  const error = wrapper.querySelector<HTMLElement>('#biometricError')!
  button.onclick = () => void biometric(button, error)
}

async function hasPasskey(memberId: string) {
  try {
    const result = await call('passkey-status', { member_id: memberId })
    const ids = Array.isArray(result?.credential_ids) ? result.credential_ids.filter((id: unknown): id is string => typeof id === 'string') : []
    return { has: !!result?.hasPasskey, ids }
  } catch {
    return { has: false, ids: [] as string[] }
  }
}

async function registerPasskey(memberId: string, house: string, nickname: string) {
  try {
    const status = await hasPasskey(memberId)
    if (status.has) {
      localStorage.setItem(PASSKEY_KEY, 'enabled')
      localStorage.setItem(PASSKEY_MEMBER_KEY, memberId)
      if (status.ids[0]) localStorage.setItem(PASSKEY_CRED_KEY, status.ids[0])
      alert('Este perfil ya tiene una huella o Face ID registrado.')
      return
    }
    const optionsResult = await call('register-options', { member_id: memberId, house_number: house, nickname })
    const response = await startRegistration({ optionsJSON: optionsResult.options })
    const result = await call('register-verify', { token: optionsResult.token, response })
    localStorage.setItem(PASSKEY_KEY, 'enabled')
    localStorage.setItem(PASSKEY_MEMBER_KEY, memberId)
    if (result?.credential_id) localStorage.setItem(PASSKEY_CRED_KEY, result.credential_id)
    alert('Listo. Este teléfono ya puede entrar con huella o reconocimiento facial.')
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name !== 'NotAllowedError' && name !== 'AbortError') alert(err instanceof Error ? err.message : 'No se pudo activar la biometría.')
  }
}

async function addSetup() {
  if (!supported()) return
  const home = document.querySelector('.shell')
  const change = document.querySelector<HTMLElement>('#change')
  if (!home || !change || document.querySelector('#enableBiometric')) return
  const raw = sessionStorage.getItem(PROFILE_KEY)
  if (!raw) return
  const profile = JSON.parse(raw) as { id: string; name: string }
  const status = await hasPasskey(profile.id)
  if (status.has) {
    localStorage.setItem(PASSKEY_KEY, 'enabled')
    localStorage.setItem(PASSKEY_MEMBER_KEY, profile.id)
    if (status.ids[0]) localStorage.setItem(PASSKEY_CRED_KEY, status.ids[0])
    return
  }
  const button = document.createElement('button')
  button.id = 'enableBiometric'
  button.className = 'biometric-setup'
  button.textContent = '🔐 Activar huella / Face ID'
  change.parentElement?.after(button)
  button.onclick = async () => {
    const house = prompt('Confirma el número de la casa.')
    if (!house) return
    const nickname = prompt(`Confirma tu apodo familiar, ${profile.name}.`)
    if (nickname) await registerPasskey(profile.id, house, nickname)
  }
}

// Never start biometric authentication automatically on page load.
// The user must explicitly press the biometric button.
const observer = new MutationObserver(() => {
  addLogin()
  void addSetup()
})
observer.observe(document.body, { childList: true, subtree: true })
addLogin()
void addSetup()

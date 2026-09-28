import { startAuthentication, startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser'
import { supabase } from './supabase'
import { getIdentity, setIdentity } from './core/identity'

const PASSKEY_DEVICE_KEY = 'familia-noa-passkey-device'
const LEGACY_KEYS = [
  'familia-noa-passkey',
  'familia-noa-passkey-credential-id',
  'familia-noa-passkey-member-id',
  'familia-noa-biometric-authenticated',
]
export const passkeySupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext
let setupInProgress = false

type PasskeyDevice = { memberId: string; credentialId?: string }
type BackendSession = { access_token:string; refresh_token:string }

function readDevice(): PasskeyDevice | null {
  try {
    const raw = localStorage.getItem(PASSKEY_DEVICE_KEY)
    if (raw) {
      const value = JSON.parse(raw) as Partial<PasskeyDevice>
      if (value.memberId) return { memberId:String(value.memberId), credentialId:value.credentialId ? String(value.credentialId) : undefined }
    }
    const memberId = localStorage.getItem('familia-noa-passkey-member-id')
    const credentialId = localStorage.getItem('familia-noa-passkey-credential-id') || undefined
    if (memberId) {
      const device = { memberId, credentialId }
      writeDevice(device)
      return device
    }
  } catch {}
  return null
}

function writeDevice(device: PasskeyDevice) {
  localStorage.setItem(PASSKEY_DEVICE_KEY, JSON.stringify(device))
  for (const key of LEGACY_KEYS) localStorage.removeItem(key)
}

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('family-passkeys-v2', { body: { action, ...payload } })
  if (error) throw new Error(error.message || 'No se pudo completar la operación.')
  if (data?.error) throw new Error(data.error)
  return data
}

async function session(profile: { id:string; name:string }, backend: BackendSession | undefined) {
  if (!backend?.access_token || !backend.refresh_token) throw new Error('No se pudo crear la sesión familiar.')
  const { error } = await supabase.auth.setSession({ access_token:backend.access_token, refresh_token:backend.refresh_token })
  if (error) throw error
  const { data:{ user }, error:userError } = await supabase.auth.getUser()
  if (userError || !user || user.app_metadata?.family_member !== true || String(user.app_metadata?.member_id || '') !== profile.id) {
    await supabase.auth.signOut({ scope:'local' })
    throw userError || new Error('La sesión familiar no coincide con este perfil.')
  }
  setIdentity({ memberId:profile.id, name:profile.name })
  window.location.reload()
}

async function biometric(button: HTMLButtonElement, error: HTMLElement) {
  if (button.disabled) return
  button.disabled = true
  error.textContent = 'Verificando…'
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    const device = readDevice()
    const payload: Record<string, unknown> = {}
    if (device?.memberId) payload.member_id = device.memberId
    if (device?.credentialId) payload.credential_ids = [device.credentialId]
    const optionsResult = await call('auth-options', payload)
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        WebAuthnAbortService.cancelCeremony()
        reject(new Error('La verificación tardó demasiado. Puedes entrar con tu perfil.'))
      }, 10000)
    })
    const response = await Promise.race([
      startAuthentication({ optionsJSON: optionsResult.options }),
      timeoutPromise,
    ])
    if (timeout) clearTimeout(timeout)
    timeout = null
    const result = await call('auth-verify', { token: optionsResult.token, response })
    if (!result?.profile?.id) throw new Error('No se pudo identificar el perfil.')
    writeDevice({ memberId:result.profile.id, credentialId:response.id })
    await session(result.profile, result.session)
  } catch (err) {
    if (timeout) clearTimeout(timeout)
    const name = err instanceof Error ? err.name : ''
    error.textContent = name === 'NotAllowedError' || name === 'AbortError'
      ? 'La verificación biométrica fue cancelada o no estuvo disponible. Puedes entrar con tu perfil.'
      : err instanceof Error ? err.message : 'No se pudo entrar con huella / Face ID.'
    button.disabled = false
  }
}

function addLogin() {
  if (!passkeySupported()) return
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

export async function getPasskeyStatus(memberId = getIdentity()?.memberId || '') {
  const device=readDevice()
  if (!memberId || !passkeySupported()) return { has:false, ids:[] as string[], supported:passkeySupported(), deviceReady:false }
  try {
    const result = await call('passkey-status', { member_id: memberId })
    const ids = Array.isArray(result?.credential_ids) ? result.credential_ids.filter((id: unknown): id is string => typeof id === 'string') : []
    const deviceReady=!!device?.credentialId&&device.memberId===memberId&&ids.includes(device.credentialId)
    return { has:!!result?.hasPasskey, ids, supported:true, deviceReady }
  } catch {
    return { has:false, ids:[] as string[], supported:true, deviceReady:false }
  }
}

export async function enablePasskeyForCurrentMember() {
  const identity = getIdentity()
  if (!identity?.memberId) throw new Error('Primero entra con tu perfil familiar.')
  if (!passkeySupported()) throw new Error('Este dispositivo no permite huella o Face ID desde la app.')
  const status = await getPasskeyStatus(identity.memberId)
  if (status.deviceReady) {
    document.dispatchEvent(new CustomEvent('family:passkey-changed'))
    return true
  }
  const optionsResult = await call('register-options', { member_id:identity.memberId })
  const response = await startRegistration({ optionsJSON:optionsResult.options })
  const result = await call('register-verify', { token:optionsResult.token, response })
  writeDevice({ memberId:identity.memberId, credentialId:result?.credential_id || response.id })
  document.dispatchEvent(new CustomEvent('family:passkey-changed'))
  return true
}

async function addSetup() {
  if (!passkeySupported() || setupInProgress) return
  const home = document.querySelector('.shell')
  const change = document.querySelector<HTMLElement>('#change')
  const identity = getIdentity()
  if (!home || !change || !identity || document.querySelector('#enableBiometric') || document.querySelector('[data-device-onboarding]')) return
  setupInProgress = true
  try {
    const status = await getPasskeyStatus(identity.memberId)
    if (status.deviceReady) return
    const button = document.createElement('button')
    button.id = 'enableBiometric'
    button.className = 'biometric-setup'
    button.textContent = '🔐 Activar huella / Face ID'
    change.parentElement?.after(button)
    button.onclick = async () => {
      button.disabled = true
      try {
        await enablePasskeyForCurrentMember()
        alert('Listo. Este teléfono ya puede entrar con huella o reconocimiento facial.')
        button.remove()
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        if (name !== 'NotAllowedError' && name !== 'AbortError') alert(err instanceof Error ? err.message : 'No se pudo activar la biometría.')
        button.disabled = false
      }
    }
  } finally {
    setupInProgress = false
  }
}

const observer = new MutationObserver(() => {
  addLogin()
  void addSetup()
})
observer.observe(document.body, { childList:true, subtree:true })
addLogin()
void addSetup()

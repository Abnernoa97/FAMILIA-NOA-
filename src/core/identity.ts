import { supabase } from '../supabase'

export type FamilyIdentity = {
  memberId: string
  name: string
}

const IDENTITY_KEY = 'familia-noa-identity'
const LEGACY_PROFILE_KEY = 'familia-noa-profile'
const LEGACY_MEMBER_KEY = 'familia-noa-member'
const IDENTITY_EVENT = 'familia-noa:identity-changed'

function normalize(value: any): FamilyIdentity | null {
  const memberId = value?.memberId || value?.id
  const name = value?.name
  if (!memberId || !name) return null
  return { memberId: String(memberId), name: String(name) }
}

function readIdentity(): FamilyIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY)
    if (raw) return normalize(JSON.parse(raw))

    // One-time migration for devices that still have the pre-centralized session.
    const legacy = sessionStorage.getItem(LEGACY_PROFILE_KEY)
    if (legacy) {
      const identity = normalize(JSON.parse(legacy))
      if (identity) {
        sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
        sessionStorage.removeItem(LEGACY_PROFILE_KEY)
        localStorage.removeItem(LEGACY_MEMBER_KEY)
        return identity
      }
    }
  } catch {
    // Invalid/stale browser state is discarded below.
  }
  sessionStorage.removeItem(IDENTITY_KEY)
  sessionStorage.removeItem(LEGACY_PROFILE_KEY)
  localStorage.removeItem(LEGACY_MEMBER_KEY)
  return null
}

export function getIdentity(): FamilyIdentity | null {
  return readIdentity()
}

export function getMemberId(): string {
  return getIdentity()?.memberId || ''
}

export function getMemberName(): string {
  return getIdentity()?.name || ''
}

export function isAuthenticated(): boolean {
  return !!getIdentity()?.memberId
}

export function setIdentity(identity: FamilyIdentity): void {
  const normalized = normalize(identity)
  if (!normalized) return
  sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(normalized))
  sessionStorage.removeItem(LEGACY_PROFILE_KEY)
  localStorage.removeItem(LEGACY_MEMBER_KEY)
  window.dispatchEvent(new CustomEvent<FamilyIdentity>(IDENTITY_EVENT, { detail: normalized }))
}

export function clearIdentity(): void {
  sessionStorage.removeItem(IDENTITY_KEY)
  sessionStorage.removeItem(LEGACY_PROFILE_KEY)
  localStorage.removeItem(LEGACY_MEMBER_KEY)
  window.dispatchEvent(new CustomEvent(IDENTITY_EVENT))
}

export function onIdentityChange(listener: (identity: FamilyIdentity | null) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<FamilyIdentity>).detail || null)
  window.addEventListener(IDENTITY_EVENT, handler)
  return () => window.removeEventListener(IDENTITY_EVENT, handler)
}

export async function getCurrentMember(): Promise<{ id: string; name: string; active: boolean } | null> {
  const identity = getIdentity()
  if (!identity) return null
  const { data, error } = await supabase
    .from('family_members')
    .select('id,name,active')
    .eq('id', identity.memberId)
    .maybeSingle()
  if (error || !data?.active) return null
  return data as { id: string; name: string; active: boolean }
}

export const identityEventName = IDENTITY_EVENT

import { supabase } from '../supabase'

export type FamilyIdentity = {
  memberId: string
  name: string
}

const PROFILE_KEY = 'familia-noa-profile'
const MEMBER_KEY = 'familia-noa-member'
const IDENTITY_EVENT = 'familia-noa:identity-changed'

function readProfile(): FamilyIdentity | null {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<FamilyIdentity> & { id?: string }
    if (!value?.id && !value?.memberId) return null
    if (!value.name) return null
    return {
      memberId: String(value.memberId || value.id),
      name: String(value.name),
    }
  } catch {
    return null
  }
}

export function getIdentity(): FamilyIdentity | null {
  return readProfile()
}

export function getMemberId(): string {
  return getIdentity()?.memberId || ''
}

export function getMemberName(): string {
  return getIdentity()?.name || localStorage.getItem(MEMBER_KEY) || ''
}

export function isAuthenticated(): boolean {
  return !!getIdentity()?.memberId
}

export function setIdentity(identity: FamilyIdentity): void {
  localStorage.setItem(MEMBER_KEY, identity.name)
  sessionStorage.setItem(PROFILE_KEY, JSON.stringify({ id: identity.memberId, memberId: identity.memberId, name: identity.name }))
  window.dispatchEvent(new CustomEvent<FamilyIdentity>(IDENTITY_EVENT, { detail: identity }))
}

export function clearIdentity(): void {
  localStorage.removeItem(MEMBER_KEY)
  sessionStorage.removeItem(PROFILE_KEY)
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

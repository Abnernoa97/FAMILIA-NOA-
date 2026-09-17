import { clearIdentity, getCurrentMember, getIdentity, onIdentityChange } from './identity'

let validationInFlight = false

async function validateIdentity(): Promise<void> {
  if (validationInFlight) return
  const identity = getIdentity()
  if (!identity) return
  validationInFlight = true
  try {
    const member = await getCurrentMember()
    if (!member) {
      clearIdentity()
      return
    }
    localStorage.setItem('familia-noa-member', member.name)
    sessionStorage.setItem('familia-noa-profile', JSON.stringify({ id: member.id, name: member.name }))
  } finally {
    validationInFlight = false
  }
}

onIdentityChange(() => void validateIdentity())
void validateIdentity()

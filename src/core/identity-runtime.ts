import { clearIdentity, getCurrentMember, getIdentity, onIdentityChange, setIdentity } from './identity'

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
    setIdentity({ memberId: member.id, name: member.name })
  } finally {
    validationInFlight = false
  }
}

onIdentityChange(() => void validateIdentity())
void validateIdentity()

import {
  clearIdentity,
  getIdentity,
  getMemberId,
  getMemberName,
  isAuthenticated,
  onIdentityChange,
  setIdentity,
} from './identity'

export type FamiliaNoaIdentityAPI = {
  get: typeof getIdentity
  getMemberId: typeof getMemberId
  getMemberName: typeof getMemberName
  isAuthenticated: typeof isAuthenticated
  set: typeof setIdentity
  clear: typeof clearIdentity
  onChange: typeof onIdentityChange
}

declare global {
  interface Window {
    familiaNoaIdentity?: FamiliaNoaIdentityAPI
  }
}

window.familiaNoaIdentity = {
  get: getIdentity,
  getMemberId,
  getMemberName,
  isAuthenticated,
  set: setIdentity,
  clear: clearIdentity,
  onChange: onIdentityChange,
}

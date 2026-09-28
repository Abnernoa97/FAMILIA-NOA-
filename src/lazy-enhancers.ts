let biometricLoaded = false
let profileLoaded = false
let assistantLoaded = false
let presenceLoaded = false
let presumeLoaded = false
let presumeLoading = false
let albumsLoaded = false
let locationLoaded = false
let deviceOnboardingLoaded = false

const loadBiometric = async () => {
  if (biometricLoaded || (!document.querySelector('.members') && !document.querySelector('.shell'))) return
  try {
    await import('./biometric-enhancer')
    biometricLoaded = true
  } catch (error) {
    biometricLoaded = false
    console.error('Biometric enhancer failed to load', error)
  }
}

const loadPresence = async () => {
  if (presenceLoaded || !document.querySelector('.shell')) return
  try {
    await import('./presence-enhancer')
    presenceLoaded = true
  } catch (error) {
    presenceLoaded = false
    console.error('Presence enhancer failed to load', error)
  }
}

const loadProfile = async () => {
  if (profileLoaded || !document.querySelector('.shell')) return
  try {
    await import('./profile-enhancer')
    await import('./profile-featured-media')
    await import('./profile-realtime')
    profileLoaded = true
  } catch (error) {
    profileLoaded = false
    console.error('Profile enhancer failed to load', error)
  }
}

const loadAssistant = async () => {
  if (assistantLoaded || !document.querySelector('.shell')) return
  try {
    await import('./profile-noa-guard')
    await import('./profile-assistant')
    await import('./noa-minimal.css')
    assistantLoaded = true
  } catch (error) {
    assistantLoaded = false
    console.error('NOA assistant failed to load', error)
  }
}

const loadPresume = async () => {
  if (presumeLoaded || presumeLoading || !document.querySelector('.shell')) return
  presumeLoading = true
  try {
    await import('./presume-enhancer')
    await import('./home-stories')
    await import('./home-story-engagement')
    await import('./home-story-responses')
    await import('./story-deep-link')
    await import('./presume-management')
    await import('./presume-memory-guard')
    await import('./presume-push-camera')
    await import('./presume-challenge-push')
    await import('./presume-editorial.css')
    await import('./presume-editorial')
    presumeLoaded = true
  } catch (error) {
    presumeLoaded = false
    console.error('PRESUME enhancer failed to load', error)
  } finally {
    presumeLoading = false
  }
}

const loadDeviceOnboarding = async () => {
  if (deviceOnboardingLoaded || !document.querySelector('.shell')) return
  try {
    await import('./device-onboarding')
    deviceOnboardingLoaded = true
  } catch (error) {
    deviceOnboardingLoaded = false
    console.error('Device onboarding failed to load', error)
  }
}

const loadAlbums = async () => {
  if (albumsLoaded || !document.querySelector('.photo-page')) return
  try {
    await import('./albums-enhancer')
    await import('./album-sections')
    albumsLoaded = true
    const root = document.querySelector<HTMLElement>('[data-photo-page]')
    if (root && !root.classList.contains('albums-page')) {
      const marker = document.createComment('familia-noa-albums-init')
      root.appendChild(marker)
      marker.remove()
    }
  } catch (error) {
    albumsLoaded = false
    console.error('Albums enhancer failed to load', error)
  }
}

const loadLocation = async () => {
  if (locationLoaded || !document.querySelector('.location-page')) return
  try {
    await import('./location-map-enhancer')
    await import('./location-privacy-enhancer')
    locationLoaded = true
  } catch (error) {
    locationLoaded = false
    console.error('Location enhancer failed to load', error)
  }
}

let observer: MutationObserver | null = null

function scan() {
  void loadBiometric()
  void loadPresence()
  void loadProfile()
  void loadAssistant()
  void loadPresume()
  void loadDeviceOnboarding()
  void loadAlbums()
  void loadLocation()
  if (biometricLoaded && profileLoaded && assistantLoaded && presenceLoaded && presumeLoaded && deviceOnboardingLoaded && albumsLoaded && locationLoaded) {
    observer?.disconnect()
    observer = null
  }
}

observer = new MutationObserver(scan)
observer.observe(document.body, { childList:true, subtree:true })
scan()
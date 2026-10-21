let profileLoaded = false
let assistantLoaded = false
let presenceLoaded = false
let presumeLoaded = false
let presumeLoading = false
let albumsLoaded = false
let locationLoaded = false
let deviceOnboardingLoaded = false

// Prevent parallel imports of the same enhancer while a WebView page is mounting.
let presenceLoading = false
let profileLoading = false
let assistantLoading = false
let albumsLoading = false
let locationLoading = false
let deviceOnboardingLoading = false

const loadPresence = async () => {
  if (presenceLoaded || presenceLoading || !document.querySelector('.shell')) return
  presenceLoading = true
  try {
    await import('./presence-enhancer')
    presenceLoaded = true
  } catch (error) {
    presenceLoaded = false
    console.error('Presence enhancer failed to load', error)
  } finally {
    presenceLoading = false
  }
}

const loadProfile = async () => {
  if (profileLoaded || profileLoading || !document.querySelector('.shell')) return
  profileLoading = true
  try {
    await import('./profile-native-bridge-fix')
    await import('./profile-enhancer')
    await import('./profile-featured-media')
    await import('./profile-realtime')
    profileLoaded = true
  } catch (error) {
    profileLoaded = false
    console.error('Profile enhancer failed to load', error)
  } finally {
    profileLoading = false
  }
}

const loadAssistant = async () => {
  if (assistantLoaded || assistantLoading || !document.querySelector('.shell')) return
  assistantLoading = true
  try {
    await import('./profile-noa-guard')
    await import('./noa-context-enhancer')
    await import('./noa-action-router')
    await import('./noa-web-tts')
    await import('./profile-assistant')
    await import('./noa-conversation-mode')
    await import('./noa-minimal.css')
    await import('./noa-draggable')
    await import('./noa-quick-prompts')
    assistantLoaded = true
  } catch (error) {
    assistantLoaded = false
    console.error('NOA assistant failed to load', error)
  } finally {
    assistantLoading = false
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
  if (deviceOnboardingLoaded || deviceOnboardingLoading || !document.querySelector('.shell')) return
  deviceOnboardingLoading = true
  try {
    await import('./device-onboarding')
    deviceOnboardingLoaded = true
  } catch (error) {
    deviceOnboardingLoaded = false
    console.error('Device onboarding failed to load', error)
  } finally {
    deviceOnboardingLoading = false
  }
}

const loadAlbums = async () => {
  if (albumsLoaded || albumsLoading || !document.querySelector('.photo-page')) return
  albumsLoading = true
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
  } finally {
    albumsLoading = false
  }
}

const loadLocation = async () => {
  if (locationLoaded || locationLoading || !document.querySelector('.location-page')) return
  locationLoading = true
  try {
    await import('./location-map-enhancer')
    await import('./location-privacy-enhancer')
    locationLoaded = true
  } catch (error) {
    locationLoaded = false
    console.error('Location enhancer failed to load', error)
  } finally {
    locationLoading = false
  }
}

let observer: MutationObserver | null = null

function scan() {
  void loadPresence()
  void loadProfile()
  void loadAssistant()
  void loadPresume()
  void loadDeviceOnboarding()
  void loadAlbums()
  void loadLocation()
  if (profileLoaded && assistantLoaded && presenceLoaded && presumeLoaded && deviceOnboardingLoaded && albumsLoaded && locationLoaded) {
    observer?.disconnect()
    observer = null
  }
}

// Coalesce rapid DOM changes into one scan per frame. The loading guards above
// avoid parallel imports while the app is hydrating or navigating.
let scanPending = false
function scheduleScan() {
  if (scanPending) return
  scanPending = true
  requestAnimationFrame(() => {
    scanPending = false
    scan()
  })
}

observer = new MutationObserver(scheduleScan)
observer.observe(document.body, { childList:true, subtree:true })
scan()

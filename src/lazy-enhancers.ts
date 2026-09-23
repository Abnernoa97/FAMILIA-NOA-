let biometricLoaded = false
let profileLoaded = false
let presumeLoaded = false
let presumeLoading = false
let albumsLoaded = false
let locationLoaded = false

const loadBiometric = async () => {
  if (biometricLoaded || !document.querySelector('.members')) return
  try {
    await import('./biometric-enhancer')
    biometricLoaded = true
  } catch (error) {
    biometricLoaded = false
    console.error('Biometric enhancer failed to load', error)
  }
}

const loadProfile = async () => {
  if (profileLoaded || !document.querySelector('.shell')) return
  try {
    await import('./profile-enhancer')
    profileLoaded = true
  } catch (error) {
    profileLoaded = false
    console.error('Profile enhancer failed to load', error)
  }
}

const loadPresume = async () => {
  if (presumeLoaded || presumeLoading || !document.querySelector('.shell')) return
  presumeLoading = true

  const NativeMutationObserver = window.MutationObserver
  class PresumeSafeMutationObserver extends NativeMutationObserver {
    constructor(callback: MutationCallback) {
      super((mutations, observer) => {
        const hasMeaningfulMutation = mutations.some(mutation => {
          const target = mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement
          return !target?.closest?.('#ok')
        })
        if (hasMeaningfulMutation) callback(mutations, observer)
      })
    }
  }

  try {
    ;(window as any).MutationObserver = PresumeSafeMutationObserver
    await import('./presume-enhancer')
    await import('./presume-management')
    await import('./presume-memory-guard')
    presumeLoaded = true
  } catch (error) {
    presumeLoaded = false
    console.error('PRESUME enhancer failed to load', error)
  } finally {
    ;(window as any).MutationObserver = NativeMutationObserver
    presumeLoading = false
  }
}

const loadAlbums = async () => {
  if (albumsLoaded || !document.querySelector('.photo-page')) return
  try {
    await import('./albums-enhancer')
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
    locationLoaded = true
  } catch (error) {
    locationLoaded = false
    console.error('Location map enhancer failed to load', error)
  }
}

let observer: MutationObserver | null = null

function scan() {
  void loadBiometric()
  void loadProfile()
  void loadPresume()
  void loadAlbums()
  void loadLocation()
  if (biometricLoaded && profileLoaded && presumeLoaded && albumsLoaded && locationLoaded) {
    observer?.disconnect()
    observer = null
  }
}

observer = new MutationObserver(scan)
observer.observe(document.body, { childList:true, subtree:true })
scan()

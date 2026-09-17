let biometricLoaded = false
let profileLoaded = false
let albumsLoaded = false

const loadBiometric = async () => {
  if (biometricLoaded || !document.querySelector('.members')) return
  biometricLoaded = true
  const module = await import('./biometric-enhancer')
  module.initBiometricEnhancer()
}

const loadProfile = async () => {
  if (profileLoaded || !document.querySelector('.shell')) return
  profileLoaded = true
  await import('./profile-enhancer')
}

const loadAlbums = async () => {
  if (albumsLoaded || !document.querySelector('.photo-page')) return
  albumsLoaded = true
  await import('./albums-enhancer')
}

function scan() {
  void loadBiometric()
  void loadProfile()
  void loadAlbums()
}

const observer = new MutationObserver(scan)
observer.observe(document.body, { childList: true, subtree: true })
scan()

let biometricLoaded = false
let profileLoaded = false
let albumsLoaded = false
let chatLoaded = false

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

const loadChat = async () => {
  if (chatLoaded || !document.querySelector('.shell, .chat-page')) return
  chatLoaded = true
  await import('./chat-runtime')
  await import('./chat-reply-thumbnail')
}

let observer: MutationObserver | null = null

function scan() {
  void loadBiometric()
  void loadProfile()
  void loadAlbums()
  void loadChat()
  if (biometricLoaded && profileLoaded && albumsLoaded && chatLoaded) {
    observer?.disconnect()
    observer = null
  }
}

observer = new MutationObserver(scan)
observer.observe(document.body, { childList: true, subtree: true })
scan()

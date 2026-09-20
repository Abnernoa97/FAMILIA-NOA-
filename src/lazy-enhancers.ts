let biometricLoaded = false
let profileLoaded = false
let albumsLoaded = false
let chatLoaded = false

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

const loadAlbums = async () => {
  if (albumsLoaded || !document.querySelector('.photo-page')) return
  try {
    await import('./albums-enhancer')
    albumsLoaded = true

    // albums-enhancer installs its observer after the photo page already exists.
    // Trigger one harmless mutation so the first visit renders immediately.
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

const loadChat = async () => {
  if (chatLoaded || !document.querySelector('.shell, .chat-page')) return
  try {
    await import('./chat-runtime')
    await import('./chat-reply-thumbnail')
    await import('./chat-viewport')
    chatLoaded = true
  } catch (error) {
    chatLoaded = false
    console.error('Chat enhancer failed to load', error)
  }
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

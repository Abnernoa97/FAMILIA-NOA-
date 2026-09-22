export type VoiceRecording = {
  file: File
  durationMs: number
}

export type VoiceRecorderSession = {
  startedAt: number
  stop: () => Promise<VoiceRecording>
  cancel: () => Promise<void>
}

const MIME_PREFERENCES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus'
]

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  return MIME_PREFERENCES.find(type => MediaRecorder.isTypeSupported?.(type)) || ''
}

function extensionFor(type: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes('mp4')) return 'm4a'
  if (normalized.includes('ogg')) return 'ogg'
  return 'webm'
}

export function canRecordVoice() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export async function beginVoiceRecording(): Promise<VoiceRecorderSession> {
  if (!canRecordVoice()) throw new Error('VOICE_RECORDING_UNSUPPORTED')

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })

  const mimeType = preferredMimeType()
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, mimeType
      ? { mimeType, audioBitsPerSecond: 64000 }
      : { audioBitsPerSecond: 64000 })
  } catch {
    recorder = new MediaRecorder(stream)
  }

  const chunks: Blob[] = []
  const startedAt = Date.now()
  let stopping = false
  let cancelled = false

  const stopTracks = () => stream.getTracks().forEach(track => track.stop())

  const result = new Promise<VoiceRecording>((resolve, reject) => {
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) chunks.push(event.data)
    })

    recorder.addEventListener('error', event => {
      stopTracks()
      reject((event as any).error || new Error('VOICE_RECORDING_FAILED'))
    }, { once: true })

    recorder.addEventListener('stop', () => {
      stopTracks()
      if (cancelled) {
        resolve({ file:new File([], 'cancelled.webm'), durationMs:0 })
        return
      }

      const type = recorder.mimeType || mimeType || chunks[0]?.type || 'audio/webm'
      const blob = new Blob(chunks, { type })
      if (!blob.size) {
        reject(new Error('VOICE_RECORDING_EMPTY'))
        return
      }

      const ext = extensionFor(type)
      resolve({
        file: new File([blob], `voz-${Date.now()}.${ext}`, { type, lastModified:Date.now() }),
        durationMs: Math.max(0, Date.now() - startedAt)
      })
    }, { once: true })
  })

  recorder.start(250)

  const stopRecorder = () => {
    if (stopping) return
    stopping = true
    if (recorder.state !== 'inactive') recorder.stop()
    else stopTracks()
  }

  return {
    startedAt,
    async stop() {
      stopRecorder()
      return result
    },
    async cancel() {
      cancelled = true
      stopRecorder()
      try { await result } catch {}
    }
  }
}

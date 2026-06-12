// Mic capture via a single persistent ffmpeg subprocess in the backend utility
// process. ffmpeg streams continuously; push-to-talk just marks start/stop in
// the sample stream. This kills the two big latency/loss sources the old
// spawn-per-press design had:
//   - 300-800ms dshow device-open before any audio flowed (start of speech lost)
//   - hard kill on release (Windows has no SIGTERM) discarding up to ~500ms of
//     unflushed audio (end of speech lost)
// Avoids Chromium Web Audio (crashes with 0xC0000005 on Windows Electron) and
// avoids native node-gyp builds (uses prebuilt @ffmpeg-installer/ffmpeg).

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

export const WHISPER_SAMPLE_RATE = 16000
const BYTES_PER_SAMPLE = 4
const MIN_SAMPLES = Math.floor(WHISPER_SAMPLE_RATE * 0.2)
const MAX_SAMPLES = WHISPER_SAMPLE_RATE * 30
// Audio kept while idle so speech that starts a beat before the hotkey lands
// is still captured.
const PREROLL_SAMPLES = Math.floor(WHISPER_SAMPLE_RATE * 0.4)
const RESTART_DELAY_MS = 3000

// Rolling PCM recorder over a continuous sample stream. While idle it keeps a
// short pre-roll; start() begins accumulating (pre-roll included), stop()
// returns the recording instantly.
export class PcmRecorder {
  private chunks: Buffer[] = []
  private total = 0 // samples
  private recording = false

  get isRecording(): boolean {
    return this.recording
  }

  push(buf: Buffer): void {
    if (this.recording) {
      if (this.total >= MAX_SAMPLES) return
      const samples = buf.length / BYTES_PER_SAMPLE
      if (this.total + samples > MAX_SAMPLES) {
        const keep = (MAX_SAMPLES - this.total) * BYTES_PER_SAMPLE
        this.chunks.push(buf.subarray(0, keep))
        this.total = MAX_SAMPLES
        return
      }
      this.chunks.push(buf)
      this.total += samples
      return
    }
    // Idle: keep a bounded pre-roll, dropping oldest chunks.
    this.chunks.push(buf)
    this.total += buf.length / BYTES_PER_SAMPLE
    while (this.total > PREROLL_SAMPLES && this.chunks.length > 1) {
      const oldest = this.chunks.shift()!
      this.total -= oldest.length / BYTES_PER_SAMPLE
    }
  }

  start(): void {
    if (this.recording) {
      // keyup was missed and the user pressed again — begin fresh
      this.chunks = []
      this.total = 0
    }
    this.recording = true
  }

  stop(): Buffer | null {
    this.recording = false
    const merged = Buffer.concat(this.chunks)
    this.chunks = []
    this.total = 0
    const sampleCount = merged.byteLength / BYTES_PER_SAMPLE
    if (sampleCount < MIN_SAMPLES) {
      console.warn('[audioCapture] recording too short:', sampleCount, 'samples')
      return null
    }
    console.error('[audioCapture] captured', sampleCount, 'samples')
    return merged
  }

  cancel(): void {
    this.recording = false
    this.chunks = []
    this.total = 0
  }
}

let ffmpegPath: string | null = null
let ffmpegProc: ChildProcessWithoutNullStreams | null = null
let captureError: string | null = null
let cachedDevice: string | null = null
let restartTimer: NodeJS.Timeout | null = null
let initializing = false
let shuttingDown = false
const recorder = new PcmRecorder()

function loadFfmpeg(): string | null {
  if (ffmpegPath) return ffmpegPath
  try {
    ffmpegPath = (require('@ffmpeg-installer/ffmpeg') as { path: string }).path
    return ffmpegPath
  } catch (err) {
    captureError = `ffmpeg unavailable: ${err}`
    console.error('[audioCapture]', captureError)
    return null
  }
}

// Async so the 1-2s dshow enumeration never blocks the backend event loop
// (the old spawnSync version froze the first push-to-talk).
function listAudioDevices(ffmpeg: string): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      windowsHide: true,
    })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('error', () => resolve([]))
    proc.on('close', () => {
      const devices: string[] = []
      let inAudioSection = false
      for (const line of out.split('\n')) {
        if (line.includes('DirectShow audio devices')) {
          inAudioSection = true
          continue
        }
        if (line.includes('DirectShow video devices')) {
          inAudioSection = false
          continue
        }
        if (!inAudioSection || line.includes('Alternative name')) continue
        const match = line.match(/\[dshow @ [^\]]+\]\s+"([^"]+)"/)
        if (match) devices.push(match[1])
      }
      resolve(devices)
    })
  })
}

// Virtual/relay devices that never carry real mic audio
const AVOID_DEVICE = /soundwire|virtual|stereo mix|voicemeeter|wasapi|loopback|line in|wave out/i
// Real physical mic keywords (ranked by preference)
const PREFER_TIERS = [
  /headset/i,
  /bose|sony|jabra|sennheiser|apple|airpod/i,
  /usb.*mic|mic.*usb/i,
  /built.?in|internal|laptop/i,
  /realtek|conexant|cirrus|hd audio/i,
]

async function pickDevice(ffmpeg: string): Promise<string | null> {
  if (cachedDevice) return cachedDevice
  const all = await listAudioDevices(ffmpeg)
  if (all.length === 0) {
    captureError = 'no audio input devices found'
    return null
  }
  console.error('[audioCapture] available devices:', all.join(', '))
  const candidates = all.filter(d => !AVOID_DEVICE.test(d))
  const pool = candidates.length > 0 ? candidates : all
  let picked: string | undefined
  for (const tier of PREFER_TIERS) {
    picked = pool.find(d => tier.test(d))
    if (picked) break
  }
  cachedDevice = picked ?? pool[0]
  console.error('[audioCapture] selected device:', cachedDevice)
  return cachedDevice
}

function scheduleRestart(): void {
  if (shuttingDown || restartTimer) return
  restartTimer = setTimeout(() => {
    restartTimer = null
    void initCapture()
  }, RESTART_DELAY_MS)
}

function spawnStream(ffmpeg: string, device: string): boolean {
  if (ffmpegProc) return true
  try {
    // -audio_buffer_size 50: default dshow buffering is ~500ms, which delays
    // samples reaching us and makes the tail of recordings late.
    ffmpegProc = spawn(
      ffmpeg,
      [
        '-f', 'dshow',
        '-audio_buffer_size', '50',
        '-i', `audio=${device}`,
        '-ar', String(WHISPER_SAMPLE_RATE), '-ac', '1', '-f', 'f32le', '-',
      ],
      { windowsHide: true },
    )
  } catch (err) {
    captureError = String(err)
    console.error('[audioCapture] start failed:', err)
    ffmpegProc = null
    return false
  }

  ffmpegProc.stdout.on('data', (buf: Buffer) => recorder.push(buf))

  ffmpegProc.stderr.on('data', (data: Buffer) => {
    const line = data.toString()
    if (/error/i.test(line)) console.error('[audioCapture] ffmpeg:', line.trim())
  })

  ffmpegProc.on('error', (err) => {
    captureError = String(err)
    console.error('[audioCapture] spawn error:', err)
    ffmpegProc = null
    cachedDevice = null // force re-scan on restart
    recorder.cancel()
    scheduleRestart()
  })

  ffmpegProc.on('close', (code) => {
    if (!ffmpegProc) return // already handled by 'error'
    ffmpegProc = null
    console.error('[audioCapture] ffmpeg stream exited with code', code, '— restarting')
    cachedDevice = null // device may have disconnected; re-scan
    recorder.cancel()
    scheduleRestart()
  })

  console.error('[audioCapture] persistent capture stream started (dshow, 16kHz mono Float32)')
  return true
}

// Start (or restart) the persistent capture stream. Called once at backend
// startup so the first push-to-talk has zero warm-up cost.
export async function initCapture(): Promise<boolean> {
  if (ffmpegProc) return true
  if (initializing) return false
  initializing = true
  try {
    const ffmpeg = loadFfmpeg()
    if (!ffmpeg) return false
    const device = await pickDevice(ffmpeg)
    if (!device) return false
    captureError = null
    return spawnStream(ffmpeg, device)
  } finally {
    initializing = false
  }
}

export function isCaptureAvailable(): boolean {
  return loadFfmpeg() !== null
}

export function getSelectedDevice(): string | null {
  return cachedDevice
}

export function getCaptureError(): string | null {
  return captureError
}

export function startCapture(): boolean {
  if (!ffmpegProc) {
    // Stream not up (still initializing or mic disappeared) — kick a restart.
    void initCapture()
    return false
  }
  recorder.start()
  return true
}

export function stopCapture(): Buffer | null {
  return recorder.stop()
}

export function cancelCapture(): void {
  recorder.cancel()
}

// Stop the capture stream for good (no auto-restart). Called on backend
// shutdown — without this, hard-killing the backend leaves the ffmpeg
// subprocess running forever (the stdout-pipe-break theory proved false:
// orphaned ffmpeg processes were observed surviving their parent).
export function shutdownCapture(): void {
  shuttingDown = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  const proc = ffmpegProc
  ffmpegProc = null // 'close' handler treats null as already-handled, skips restart
  try { proc?.kill() } catch { /* ignore */ }
}

process.on('exit', () => shutdownCapture())

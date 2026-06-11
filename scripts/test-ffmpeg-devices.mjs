import { spawnSync } from 'child_process'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'

const ffmpeg = ffmpegInstaller.path
const result = spawnSync(ffmpeg, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { encoding: 'utf8' })
const out = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
const devices = []
let inAudioSection = false
for (const line of out.split('\n')) {
  if (line.includes('DirectShow audio devices')) { inAudioSection = true; continue }
  if (line.includes('DirectShow video devices')) { inAudioSection = false; continue }
  if (!inAudioSection || line.includes('Alternative name')) continue
  const match = line.match(/\[dshow @ [^\]]+\]\s+"([^"]+)"/)
  if (match) devices.push(match[1])
}
console.log('ffmpeg:', ffmpeg)
console.log('audio devices:', devices)

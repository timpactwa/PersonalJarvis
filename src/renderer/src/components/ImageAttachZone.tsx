import { useRef, useState } from 'react'

interface ImageAttachZoneProps {
  imageAttached: boolean
  onAttach: (base64: string, mimeType: string) => void
  onClear: () => void
}

export function ImageAttachZone({ imageAttached, onAttach, onClear }: ImageAttachZoneProps): JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File): void => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64) onAttach(base64, file.type)
    }
    reader.readAsDataURL(file)
  }

  const handleDragOver = (e: React.DragEvent): void => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = (): void => setDragOver(false)
  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }
  const handleClick = (): void => {
    if (imageAttached) { onClear(); return }
    fileInputRef.current?.click()
  }
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 76,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(580px, 84vw)',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 14px',
    borderRadius: 20,
    border: dragOver
      ? '1px dashed rgba(34,211,238,0.6)'
      : imageAttached
      ? '1px solid rgba(34,211,238,0.45)'
      : '1px dashed rgba(34,211,238,0.28)',
    background: dragOver
      ? 'rgba(34,211,238,0.12)'
      : imageAttached
      ? 'rgba(34,211,238,0.10)'
      : 'rgba(8,12,24,0.55)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: '0.1em',
    color: imageAttached ? '#22d3ee' : dragOver ? '#22d3ee' : 'rgba(34,211,238,0.5)',
    transition: 'all 0.2s',
    userSelect: 'none',
    boxShadow: imageAttached ? '0 0 12px rgba(34,211,238,0.20)' : 'none',
  }

  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
      <div className="no-drag" style={baseStyle} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <div style={pillStyle} onClick={handleClick}>
          <span style={{ fontSize: 11 }}>{imageAttached ? '📎' : dragOver ? '⬇' : '📷'}</span>
          <span>
            {imageAttached ? (
              <>
                IMAGE READY{'  '}
                <span style={{ animation: imageAttached ? 'pulse 1.5s ease infinite' : 'none' }}>●</span>
              </>
            ) : dragOver ? 'DROP HERE' : 'ATTACH IMAGE'}
          </span>
          {imageAttached && (
            <span
              style={{ marginLeft: 4, opacity: 0.6, fontSize: 11, color: '#22d3ee' }}
              onClick={e => { e.stopPropagation(); onClear() }}
              title="Remove image"
            >
              ✕
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
    </>
  )
}

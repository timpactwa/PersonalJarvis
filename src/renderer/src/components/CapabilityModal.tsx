import { useState } from 'react'

interface Props {
  name: string
  description: string
  onSubmit: (prompt: string, context: string) => void
  onClose: () => void
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: "'Orbitron', var(--font-hud)",
  fontSize: 9,
  letterSpacing: '0.18em',
  color: 'var(--ov-accent)',
  marginBottom: 6,
  textTransform: 'uppercase',
}

const fieldWrap: React.CSSProperties = { marginBottom: 16 }

export function CapabilityModal({ name, description, onSubmit, onClose }: Props): JSX.Element {
  const [capName, setCapName] = useState(name)
  const [desc, setDesc] = useState(description)
  const [extra, setExtra] = useState('')

  const submit = (): void => {
    const prompt = `${capName.trim()}\n\n${desc.trim()}\n\nAdditional requirements:\n${extra.trim()}`
    onSubmit(prompt, extra.trim())
  }

  return (
    <div
      className="no-drag"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        backdropFilter: 'blur(4px)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 520,
          maxWidth: '88vw',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--ov-bg)',
          border: '1px solid rgba(14, 165, 233, 0.3)',
          borderRadius: 'var(--ov-radius)',
          boxShadow: 'var(--ov-shadow), 0 0 40px rgba(14,165,233,0.12)',
          padding: '24px 26px',
          animation: 'overlayIn 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        <div
          style={{
            fontFamily: "'Orbitron', var(--font-hud)",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--ov-accent)',
            marginBottom: 4,
            textShadow: '0 0 12px rgba(14,165,233,0.4)',
          }}
        >
          CAPABILITY REQUEST
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--ov-text-mid)',
            letterSpacing: '0.04em',
            marginBottom: 22,
          }}
        >
          Jarvis wants to teach itself a new skill. Refine the request below.
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Capability Name</label>
          <input
            className="ov-input"
            value={capName}
            onChange={(e) => setCapName(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Description</label>
          <textarea
            className="ov-input"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        <div style={fieldWrap}>
          <label style={labelStyle}>Additional Requirements</label>
          <textarea
            className="ov-input"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={4}
            placeholder="What specific behavior do you want? Edge cases? Any preferences?"
            style={{ resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button className="pill-btn" onClick={onClose}>CANCEL</button>
          <button className="pill-btn pill-btn--active" onClick={submit}>ADD CAPABILITY</button>
        </div>
      </div>
    </div>
  )
}

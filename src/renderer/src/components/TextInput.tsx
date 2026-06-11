import { useEffect, useRef, useState } from 'react'

interface Props {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function TextInput({ onSubmit, disabled }: Props): JSX.Element {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (): void => {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
    setValue('')
    inputRef.current?.blur()
  }

  return (
    <div
      className="no-drag"
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(580px, 84vw)',
        zIndex: 10,
        opacity: disabled ? 0.35 : focused || value ? 1 : 0.72,
        transition: 'opacity 0.25s',
      }}
    >
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          placeholder={focused ? '' : 'ask anything…'}
          onChange={e => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          style={{
            width: '100%',
            padding: '11px 44px 11px 16px',
            borderRadius: 10,
            border: '1px solid',
            borderColor: focused ? 'rgba(3,105,161,0.45)' : 'rgba(3,105,161,0.18)',
            background: focused ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.75)',
            color: '#0a2540',
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            outline: 'none',
            boxShadow: focused
              ? '0 2px 16px rgba(3,105,161,0.12), 0 0 0 3px rgba(3,105,161,0.06)'
              : '0 1px 4px rgba(3,80,140,0.06)',
            transition: 'border-color 0.2s, box-shadow 0.2s, background 0.2s',
            letterSpacing: '0.03em',
            backdropFilter: 'blur(8px)',
          }}
        />
        {value && (
          <button
            onClick={submit}
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent)',
              fontSize: 14,
              padding: '2px 4px',
              opacity: 0.8,
            }}
          >↵</button>
        )}
      </div>
      {!focused && !value && (
        <div style={{
          textAlign: 'center',
          marginTop: 5,
          fontFamily: 'var(--font-data)',
          fontSize: 9,
          letterSpacing: '0.22em',
          color: 'rgba(3,105,161,0.28)',
        }}>
          CTRL+K TO FOCUS · HOLD M TO SPEAK
        </div>
      )}
    </div>
  )
}

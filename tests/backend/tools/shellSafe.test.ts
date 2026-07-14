import { describe, it, expect } from 'vitest'
import { hasShellBreakout, assertNoShellBreakout } from '../../../src/backend/tools/shellSafe'

describe('hasShellBreakout', () => {
  it('flags characters that can break out of a quoted cmd.exe argument', () => {
    expect(hasShellBreakout('C:\\evil" & calc & "x')).toBe(true)   // quote breakout
    expect(hasShellBreakout('%USERPROFILE%\\x')).toBe(true)         // env expansion
    expect(hasShellBreakout('line1\r\nshutdown -s')).toBe(true)     // injected newline
    expect(hasShellBreakout('a\nb')).toBe(true)
  })

  it('allows legitimate Windows paths and URIs', () => {
    expect(hasShellBreakout('C:\\Program Files\\App\\app.exe')).toBe(false) // spaces OK
    expect(hasShellBreakout('D:\\Music\\Rock & Roll\\play.exe')).toBe(false) // & inert in quotes
    expect(hasShellBreakout('spotify:')).toBe(false)
    expect(hasShellBreakout('discord://')).toBe(false)
    expect(hasShellBreakout('steam://rungameid/2767030')).toBe(false)
    expect(hasShellBreakout('C:\\Users\\me\\Marvel Rivals\\MarvelRivals_Launcher.exe')).toBe(false)
  })
})

describe('assertNoShellBreakout', () => {
  it('returns the value unchanged when safe (usable inline)', () => {
    expect(assertNoShellBreakout('C:\\Program Files\\x.exe')).toBe('C:\\Program Files\\x.exe')
  })

  it('throws with the provided label when unsafe', () => {
    expect(() => assertNoShellBreakout('a" & calc', 'launch target')).toThrow(/launch target/)
    expect(() => assertNoShellBreakout('a" & calc')).toThrow(/unsafe character/)
  })
})

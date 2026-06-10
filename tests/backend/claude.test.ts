import { describe, it, expect } from 'vitest'
import { selectModel } from '../../src/backend/claude'

describe('selectModel', () => {
  it('routes short messages without tool keywords to haiku', () => {
    expect(selectModel('open vs code')).toBe('claude-haiku-4-5-20251001')
  })

  it('routes long messages to fable', () => {
    const long = 'Can you search my emails for the invoice from last month and summarize the total amount due?'
    expect(selectModel(long)).toBe('claude-fable-5')
  })

  it('routes messages with tool keywords to fable', () => {
    expect(selectModel('check my email')).toBe('claude-fable-5')
    expect(selectModel('open spotify')).toBe('claude-fable-5')
    expect(selectModel('find the file')).toBe('claude-fable-5')
    expect(selectModel('remember that I prefer mornings')).toBe('claude-fable-5')
  })

  it('routes short conversational messages to haiku', () => {
    expect(selectModel('what time is it')).toBe('claude-haiku-4-5-20251001')
    expect(selectModel('hello jarvis')).toBe('claude-haiku-4-5-20251001')
  })
})

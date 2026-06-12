import { describe, it, expect } from 'vitest'
import { selectModel, isChatAvailable } from '../../src/backend/claude'

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-6'
const OPUS = 'claude-opus-4-6'

describe('selectModel — auto mode', () => {
  // ── Fast tier ──────────────────────────────────────────────
  it('routes short conversational to Haiku', () => {
    expect(selectModel('hello')).toBe(HAIKU)
    expect(selectModel('what time is it')).toBe(HAIKU)
    expect(selectModel('good morning')).toBe(HAIKU)
    expect(selectModel('tell me a joke')).toBe(HAIKU)
  })

  it('routes single app_launch to Haiku', () => {
    expect(selectModel('launch spotify')).toBe(HAIKU)
    expect(selectModel('launch chrome')).toBe(HAIKU)
  })

  it('routes spotify control to Haiku', () => {
    expect(selectModel('pause the music')).toBe(HAIKU)
    expect(selectModel('play my workout playlist')).toBe(HAIKU)
    expect(selectModel('skip this song')).toBe(HAIKU)
  })

  it('routes simple web search to Haiku', () => {
    expect(selectModel('search for the weather today')).toBe(HAIKU)
    expect(selectModel("what's the weather today")).toBe(HAIKU)
  })

  it('routes short "research X" to Sonnet not Haiku (search substring bug)', () => {
    // "research" contains "search" — word-boundary check prevents false Fast-tier match
    expect(selectModel('research machine learning')).toBe(SONNET)
  })

  it('routes "read config.json" to Haiku', () => {
    expect(selectModel('read config.json')).toBe(HAIKU)
  })

  it('routes "list my calendar" to Haiku', () => {
    expect(selectModel('list my calendar')).toBe(HAIKU)
  })

  it('routes "schedule a meeting" to Sonnet (not Haiku)', () => {
    // calendar_create-type requests should stay Smart
    expect(selectModel('schedule a meeting tomorrow morning with the team')).toBe(SONNET)
  })

  // ── Smart tier ─────────────────────────────────────────────
  it('routes email compose to Sonnet', () => {
    expect(selectModel('send an email to bob about the meeting tomorrow')).toBe(SONNET)
    expect(selectModel('check my email')).toBe(SONNET)
  })

  it('routes github tools to Sonnet', () => {
    expect(selectModel('show me the open PRs on this repo')).toBe(SONNET)
    expect(selectModel('list the open issues on github')).toBe(SONNET)
    expect(selectModel('show the latest commit')).toBe(SONNET)
  })

  it('routes medium-length requests to Sonnet', () => {
    expect(selectModel('read the config file and tell me what ports are configured')).toBe(SONNET)
  })

  it('routes script execution to Sonnet', () => {
    expect(selectModel('execute the file')).toBe(SONNET)
  })

  // ── Deep tier ──────────────────────────────────────────────
  it('routes spawn_agent-style research requests to Fable', () => {
    expect(selectModel('research the top 5 javascript frameworks and compare their performance benchmarks in detail')).toBe(OPUS)
  })

  it('routes explicit spawn_agent / pr_describe mentions to Fable', () => {
    expect(selectModel('use spawn_agent for this')).toBe(OPUS)
    expect(selectModel('run pr_describe on my branch')).toBe(OPUS)
  })

  it('routes "plan" keyword with substantive content to Fable', () => {
    expect(selectModel('plan out the architecture for a new authentication system with oauth and jwt')).toBe(OPUS)
  })

  it('routes "analyze" with substantive content to Fable', () => {
    expect(selectModel('analyze the performance bottlenecks in the codebase and suggest specific improvements to make')).toBe(OPUS)
  })

  it('routes "summarize" with substantive content to Fable', () => {
    expect(selectModel('summarize all the open issues and group them by priority and estimated complexity')).toBe(OPUS)
  })

  it('short "plan" does NOT escalate to Fable', () => {
    // A deep keyword alone is not enough — Fable requires substantive content.
    const result = selectModel('what should I plan for today')
    expect(result).not.toBe(OPUS)
  })

  // ── stepCount escalation ───────────────────────────────────
  it('escalates to Fable when a chain has consumed ≥4 tool calls', () => {
    expect(selectModel('pause the music', undefined, 4)).toBe(OPUS)
    expect(selectModel('pause the music', undefined, 7)).toBe(OPUS)
  })

  it('does not escalate below 4 steps', () => {
    expect(selectModel('pause the music', undefined, 3)).toBe(HAIKU)
    expect(selectModel('pause the music', undefined, 0)).toBe(HAIKU)
  })

  // ── forceModel override ────────────────────────────────────
  it('respects forceModel override', () => {
    expect(selectModel('hello', OPUS)).toBe(OPUS)
  })

  it('respects haiku preference override', () => {
    expect(selectModel('analyze everything deeply and write a comprehensive report', HAIKU)).toBe(HAIKU)
  })

  it('forceModel beats stepCount escalation', () => {
    expect(selectModel('pause the music', HAIKU, 9)).toBe(HAIKU)
  })
})

describe('isChatAvailable', () => {
  it('returns false when neither credential env var is set', () => {
    const savedToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const savedKey = process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
    expect(isChatAvailable()).toBe(false)
    if (savedToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = savedToken
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
  })

  it('returns true when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token'
    expect(isChatAvailable()).toBe(true)
    if (saved !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = saved
    else delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  })

  it('returns true when ANTHROPIC_API_KEY is set', () => {
    const savedToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const savedKey = process.env.ANTHROPIC_API_KEY
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.ANTHROPIC_API_KEY = 'test-key'
    expect(isChatAvailable()).toBe(true)
    if (savedToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = savedToken
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
    else delete process.env.ANTHROPIC_API_KEY
  })
})

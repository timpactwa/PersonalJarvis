import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  // eslint-disable-next-line require-yield
  query: vi.fn(async function* () {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it.' }] } }
    yield { type: 'result', subtype: 'success', result: 'Listed 3 files.' }
  }),
}))

describe('agents (Agent SDK)', () => {
  beforeEach(async () => {
    const { _resetAgents } = await import('../../src/backend/agents')
    _resetAgents()
  })

  it('exports agentToolDefs with spawn_agent', async () => {
    const mod = await import('../../src/backend/agents')
    expect(mod.agentToolDefs.map(t => t.name)).toContain('spawn_agent')
  })

  it('spawnAgent registers an agent and returns an acknowledgement', async () => {
    const { spawnAgent, getAgents } = await import('../../src/backend/agents')
    const reply = await spawnAgent('Researcher', 'Summarize notes')
    expect(reply.toLowerCase()).toContain('researcher')
    expect(getAgents().length).toBe(1)
  })

  it('closeAgent removes an agent', async () => {
    const { spawnAgent, getAgents, closeAgent } = await import('../../src/backend/agents')
    await spawnAgent('Temp', 'task')
    const a = getAgents()[0]
    closeAgent(a.id)
    expect(getAgents().some(x => x.id === a.id)).toBe(false)
  })
})

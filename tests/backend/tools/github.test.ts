import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process before the github module loads (promisify wraps execFile at import time)
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

import * as cp from 'child_process'

type ExecFileCallback = (err: Error | null, result: { stdout: string; stderr: string }) => void

function mockExec(stdout: string): void {
  vi.mocked(cp.execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      ;(cb as ExecFileCallback)(null, { stdout, stderr: '' })
      return {} as ReturnType<typeof cp.execFile>
    },
  )
}

function mockExecError(message: string, stderr = ''): void {
  vi.mocked(cp.execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error(message), { stderr })
      ;(cb as ExecFileCallback)(err, { stdout: '', stderr })
      return {} as ReturnType<typeof cp.execFile>
    },
  )
}

beforeEach(() => vi.clearAllMocks())

describe('handleGithubTool', () => {
  it('github_pr_list — formats PR list', async () => {
    const prs = [
      { number: 42, title: 'Fix bug', author: { login: 'alice' }, state: 'OPEN', updatedAt: '2024-01-15T10:00:00Z', isDraft: false },
      { number: 7, title: 'New feature', author: { login: 'bob' }, state: 'OPEN', updatedAt: '2024-01-14T08:00:00Z', isDraft: true },
    ]
    mockExec(JSON.stringify(prs))

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_list', {})

    expect(result).toContain('#42')
    expect(result).toContain('Fix bug')
    expect(result).toContain('@alice')
    expect(result).toContain('#7')
    expect(result).toContain('[DRAFT]')
    expect(result).toContain('@bob')
  })

  it('github_pr_list — returns "No open pull requests." for empty array', async () => {
    mockExec(JSON.stringify([]))

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_list', {})

    expect(result).toBe('No open pull requests.')
  })

  it('github_pr_list — returns helpful message when gh not installed', async () => {
    mockExecError('ENOENT: gh not found')

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_list', {})

    expect(result).toContain('gh CLI not found')
    expect(result).toContain('https://cli.github.com/')
  })

  it('github_pr_view — formats PR details with file list', async () => {
    const pr = {
      number: 42,
      title: 'Fix important bug',
      body: 'This fixes the crash on startup.',
      author: { login: 'alice' },
      state: 'OPEN',
      additions: 15,
      deletions: 3,
      files: [
        { path: 'src/main.ts' },
        { path: 'src/utils.ts' },
      ],
    }
    mockExec(JSON.stringify(pr))

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_view', { pr_number: 42 })

    expect(result).toContain('PR #42: Fix important bug')
    expect(result).toContain('OPEN')
    expect(result).toContain('@alice')
    expect(result).toContain('+15')
    expect(result).toContain('-3')
    expect(result).toContain('src/main.ts')
    expect(result).toContain('src/utils.ts')
    expect(result).toContain('This fixes the crash on startup.')
  })

  it('github_issue_list — formats issue list', async () => {
    const issues = [
      { number: 5, title: 'Crash on load', author: { login: 'charlie' }, labels: [{ name: 'bug' }], updatedAt: '2024-01-10T00:00:00Z' },
      { number: 6, title: 'Add dark mode', author: { login: 'dave' }, labels: [], updatedAt: '2024-01-09T00:00:00Z' },
    ]
    mockExec(JSON.stringify(issues))

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_issue_list', {})

    expect(result).toContain('#5')
    expect(result).toContain('Crash on load')
    expect(result).toContain('@charlie')
    expect(result).toContain('[bug]')
    expect(result).toContain('#6')
    expect(result).toContain('Add dark mode')
    expect(result).toContain('@dave')
  })

  it('github_issue_list — returns "No open issues." for empty array', async () => {
    mockExec(JSON.stringify([]))

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_issue_list', {})

    expect(result).toBe('No open issues.')
  })

  it('github_repo_status — formats branch + sync status', async () => {
    let callCount = 0
    vi.mocked(cp.execFile).mockImplementation(
      (_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
        callCount++
        const argv = args as string[]
        let stdout = ''
        if (argv.includes('rev-parse')) {
          stdout = 'feature/my-branch\n'
        } else if (argv.includes('--short')) {
          stdout = ' M src/index.ts\n'
        } else if (argv.includes('--left-right')) {
          stdout = '2\t1\n'
        }
        ;(cb as ExecFileCallback)(null, { stdout, stderr: '' })
        return {} as ReturnType<typeof cp.execFile>
      },
    )

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_repo_status', {})

    expect(result).toContain('Branch: feature/my-branch')
    expect(result).toContain('ahead')
    expect(result).toContain('behind')
    expect(result).toContain('Uncommitted changes')
    expect(result).toContain('src/index.ts')
  })

  it('github_pr_describe — returns commits + diff stat', async () => {
    let callCount = 0
    vi.mocked(cp.execFile).mockImplementation(
      (_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
        callCount++
        const argv = args as string[]
        let stdout = ''
        if (argv.includes('--oneline')) {
          stdout = 'abc1234 Add cool feature\ndef5678 Fix typo\n'
        } else if (argv.includes('--stat')) {
          stdout = ' src/app.ts | 10 +++++-----\n 1 file changed, 5 insertions(+), 5 deletions(-)\n'
        }
        ;(cb as ExecFileCallback)(null, { stdout, stderr: '' })
        return {} as ReturnType<typeof cp.execFile>
      },
    )

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_describe', {})

    expect(result).toContain('--- Commits ---')
    expect(result).toContain('Add cool feature')
    expect(result).toContain('--- Diff stat ---')
    expect(result).toContain('src/app.ts')
  })

  it('github_pr_describe — returns "No commits found" for empty log', async () => {
    vi.mocked(cp.execFile).mockImplementation(
      (_cmd: unknown, args: unknown, _opts: unknown, cb: unknown) => {
        const argv = args as string[]
        let stdout = ''
        if (argv.includes('--stat')) {
          stdout = ' src/app.ts | 1 +\n'
        }
        ;(cb as ExecFileCallback)(null, { stdout, stderr: '' })
        return {} as ReturnType<typeof cp.execFile>
      },
    )

    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_describe', {})

    expect(result).toContain('No commits found')
    expect(result).toContain('main')
  })

  it('dispatch — throws for unknown tool name', async () => {
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    await expect(handleGithubTool('github_unknown_tool', {})).rejects.toThrow('Unknown github tool: github_unknown_tool')
  })
})

describe('githubToolDefs', () => {
  it('exports the expected tool definitions', async () => {
    const { githubToolDefs } = await import('../../../src/backend/tools/github')
    expect(Array.isArray(githubToolDefs)).toBe(true)
    expect(githubToolDefs).toHaveLength(6)
    const names = githubToolDefs.map((t: { name: string }) => t.name)
    expect(names).toContain('github_pr_list')
    expect(names).toContain('github_pr_view')
    expect(names).toContain('github_issue_list')
    expect(names).toContain('github_commit_log')
    expect(names).toContain('github_repo_status')
    expect(names).toContain('github_pr_describe')
  })
})

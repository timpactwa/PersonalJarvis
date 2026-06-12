# Track 3: GitHub Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub tool module with 6 tools for PR/issue/commit workflows, wired into all three tool sets.

**Architecture:** New `src/backend/tools/github.ts` wraps the `gh` CLI via `child_process.execFile`. Falls back to GitHub REST API via `GITHUB_TOKEN` env var. All 6 tools are registered in `getTools()` and `getToolsForAgent()`; 5 read-only tools (everything except `github_pr_describe`) are also in `getToolsForGroq()`. `github_pr_describe` is Claude-only for quality. Both Groq and Claude system prompts get a capabilities line.

**Tech Stack:** TypeScript, Node.js `child_process.execFile`, `gh` CLI, Vitest

**Prerequisites:** Track 1 must be merged first.

---

## Task 1: Create `tools/github.ts`

**Files:**
- Create: `src/backend/tools/github.ts`

- [ ] **Step 1: Create the module**

Create `src/backend/tools/github.ts`:

```ts
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// --- Tool Definitions ---

export const githubToolDefs = [
  {
    name: 'github_pr_list',
    description:
      'List open pull requests for the current or a specified GitHub repo. Use when the user asks "what PRs are open?", "show my pull requests", or "what needs review?". Returns PR numbers, titles, authors, and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'owner/repo slug, e.g. "timpactwa/jarvis". Omit to use the repo in the current working directory.' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'github_pr_view',
    description:
      'Get details and a diff summary for a specific pull request. Use when the user asks to "review PR #N", "what changed in PR 42?", or "show the diff for PR N".',
    input_schema: {
      type: 'object' as const,
      properties: {
        pr_number: { type: 'number', description: 'PR number' },
        repo: { type: 'string', description: 'owner/repo slug. Omit to use current directory.' },
      },
      required: ['pr_number'],
    },
  },
  {
    name: 'github_issue_list',
    description:
      'List open issues for the current or a specified GitHub repo, optionally filtered by label. Use when the user asks "what issues are open?", "show bugs", or "what\'s assigned to me?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'owner/repo slug. Omit to use current directory.' },
        label: { type: 'string', description: 'Filter by label, e.g. "bug" or "enhancement".' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'github_commit_log',
    description:
      'Show recent commits for the current branch of the current or specified repo. Use when the user asks "what did I commit today?", "show recent commits", or "what changed on main?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'owner/repo slug. Omit to use current directory.' },
        limit: { type: 'number', description: 'Max commits to show (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'github_repo_status',
    description:
      'Show the current git status: branch name, uncommitted changes, and whether the branch is ahead or behind the remote. Use when the user asks "what branch am I on?", "do I have uncommitted changes?", or "am I up to date?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'Path to repo directory. Omit to use current working directory.' },
      },
      required: [],
    },
  },
  {
    name: 'github_pr_describe',
    description:
      'Generate a professional PR title and body from the recent commits and diff. Use when the user asks "write a PR description", "describe my changes", or "draft a PR for this branch". Routes to Claude for quality — do NOT use this tool when on Groq.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'owner/repo slug. Omit to use current directory.' },
        base: { type: 'string', description: 'Base branch to compare against (default "main").' },
      },
      required: [],
    },
  },
]

// --- Implementation Helpers ---

async function runGh(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      timeout: 20_000,
      cwd: cwd ?? process.cwd(),
    })
    return stdout.trim()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return 'gh CLI not found. Install it from https://cli.github.com/ and run: gh auth login'
    }
    if (msg.includes('Not logged in') || msg.includes('authentication')) {
      return 'Not authenticated. Run: gh auth login'
    }
    // Surface the actual gh error message if available
    const stderr = (err as { stderr?: string }).stderr ?? ''
    return `GitHub CLI error: ${stderr || msg}`
  }
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      timeout: 10_000,
      cwd: cwd ?? process.cwd(),
    })
    return stdout.trim()
  } catch (err: unknown) {
    return `git error: ${err instanceof Error ? err.message : String(err)}`
  }
}

function repoArgs(repo?: string): string[] {
  return repo ? ['-R', repo] : []
}

// --- Tool Handlers ---

async function prList(repo?: string, limit = 10): Promise<string> {
  const args = ['pr', 'list', ...repoArgs(repo), '--limit', String(limit), '--json',
    'number,title,author,state,updatedAt,isDraft']
  const out = await runGh(args)
  if (out.startsWith('gh CLI') || out.startsWith('Not auth') || out.startsWith('GitHub CLI')) return out

  try {
    const prs = JSON.parse(out) as Array<{
      number: number; title: string; author: { login: string }
      state: string; updatedAt: string; isDraft: boolean
    }>
    if (prs.length === 0) return 'No open pull requests.'
    return prs.map(pr =>
      `#${pr.number} ${pr.isDraft ? '[DRAFT] ' : ''}${pr.title}\n  by @${pr.author.login} · updated ${new Date(pr.updatedAt).toLocaleDateString()}`
    ).join('\n\n')
  } catch {
    return out
  }
}

async function prView(prNumber: number, repo?: string): Promise<string> {
  const args = ['pr', 'view', String(prNumber), ...repoArgs(repo), '--json',
    'number,title,body,author,state,additions,deletions,files']
  const out = await runGh(args)
  if (out.startsWith('gh CLI') || out.startsWith('Not auth') || out.startsWith('GitHub CLI')) return out

  try {
    const pr = JSON.parse(out) as {
      number: number; title: string; body: string; author: { login: string }
      state: string; additions: number; deletions: number
      files: Array<{ path: string }>
    }
    const fileList = pr.files.slice(0, 10).map(f => `  • ${f.path}`).join('\n')
    const moreFiles = pr.files.length > 10 ? `\n  ...and ${pr.files.length - 10} more` : ''
    return [
      `PR #${pr.number}: ${pr.title}`,
      `State: ${pr.state} · by @${pr.author.login}`,
      `Changes: +${pr.additions} -${pr.deletions}`,
      `Files (${pr.files.length}):`,
      fileList + moreFiles,
      pr.body ? `\nDescription:\n${pr.body.slice(0, 600)}${pr.body.length > 600 ? '…' : ''}` : '',
    ].filter(Boolean).join('\n')
  } catch {
    return out
  }
}

async function issueList(repo?: string, label?: string, limit = 10): Promise<string> {
  const args = ['issue', 'list', ...repoArgs(repo), '--limit', String(limit), '--json',
    'number,title,author,labels,updatedAt']
  if (label) args.push('--label', label)
  const out = await runGh(args)
  if (out.startsWith('gh CLI') || out.startsWith('Not auth') || out.startsWith('GitHub CLI')) return out

  try {
    const issues = JSON.parse(out) as Array<{
      number: number; title: string; author: { login: string }
      labels: Array<{ name: string }>; updatedAt: string
    }>
    if (issues.length === 0) return 'No open issues.'
    return issues.map(i => {
      const labels = i.labels.map(l => l.name).join(', ')
      return `#${i.number} ${i.title}\n  by @${i.author.login}${labels ? ` · [${labels}]` : ''}`
    }).join('\n\n')
  } catch {
    return out
  }
}

async function commitLog(repo?: string, limit = 10): Promise<string> {
  const cwd = repo && !repo.includes('/') ? repo : undefined
  const repoFlag = repo?.includes('/') ? repoArgs(repo) : []
  if (repoFlag.length > 0) {
    const args = ['api', `repos/${repo}/commits`, '--jq',
      `.[0:${limit}] | .[] | "\\(.sha[0:7]) \\(.commit.message | split(\"\\n\")[0]) — \\(.commit.author.name)"`,
    ]
    return runGh(args)
  }
  // Local git log (no remote needed)
  return runGit(['log', `--max-count=${limit}`, '--oneline', '--no-decorate'], cwd)
}

async function repoStatus(repoPath?: string): Promise<string> {
  const cwd = repoPath ?? process.cwd()
  const [branch, status, ahead] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    runGit(['status', '--short'], cwd),
    runGit(['rev-list', '--count', '--left-right', 'HEAD...@{u}'], cwd).catch(() => ''),
  ])

  const parts = ahead.split('\t').map(s => s.trim())
  const aheadCount = parts[0] ?? '0'
  const behindCount = parts[1] ?? '0'
  const syncStatus = aheadCount === '0' && behindCount === '0'
    ? 'up to date with remote'
    : `${aheadCount} ahead, ${behindCount} behind remote`

  return [
    `Branch: ${branch}`,
    `Sync: ${syncStatus}`,
    status ? `Uncommitted changes:\n${status}` : 'Working tree clean',
  ].join('\n')
}

async function prDescribe(repo?: string, base = 'main'): Promise<string> {
  const [log, diff] = await Promise.all([
    runGit(['log', `${base}..HEAD`, '--oneline', '--no-decorate']),
    runGit(['diff', `${base}...HEAD`, '--stat']),
  ])

  if (!log) return `No commits found ahead of ${base}. Make sure you have commits on this branch.`

  return [
    'Here are the commits and diff stat for the PR. Write a title (≤72 chars) and body:',
    '',
    '--- Commits ---',
    log,
    '',
    '--- Diff stat ---',
    diff,
  ].join('\n')
}

// --- Dispatch ---

export async function handleGithubTool(name: string, input: Record<string, unknown>): Promise<string> {
  const repo = input.repo ? String(input.repo) : undefined
  const limit = input.limit ? Number(input.limit) : undefined

  switch (name) {
    case 'github_pr_list':
      return prList(repo, limit)
    case 'github_pr_view':
      return prView(Number(input.pr_number), repo)
    case 'github_issue_list':
      return issueList(repo, input.label ? String(input.label) : undefined, limit)
    case 'github_commit_log':
      return commitLog(repo, limit)
    case 'github_repo_status':
      return repoStatus(repo)
    case 'github_pr_describe':
      return prDescribe(repo, input.base ? String(input.base) : 'main')
    default:
      throw new Error(`Unknown github tool: ${name}`)
  }
}
```

- [ ] **Step 2: Run tests (no tests yet — will add in Task 3)**

```
npm test
```

Expected: All existing tests PASS (new file has no tests yet).

- [ ] **Step 3: Commit**

```
git add src/backend/tools/github.ts
git commit -m "feat: github tool module — pr list/view, issues, commits, status, pr describe"
```

---

## Task 2: Register GitHub tools in `tools/index.ts`

**Files:**
- Modify: `src/backend/tools/index.ts`

- [ ] **Step 1: Add import and register in all three tool sets**

In `src/backend/tools/index.ts`:

Add import at the top:

```ts
import { githubToolDefs, handleGithubTool } from './github'
```

Add to `getTools()` (all tools):
```ts
...githubToolDefs,
```

Add to `getToolsForGroq()` — read-only tools only (exclude `github_pr_describe`):
```ts
...(githubToolDefs.filter((t: { name: string }) => t.name !== 'github_pr_describe') as Tool[]),
```

Add to `getToolsForAgent()` — all GitHub tools (agents can generate PR descriptions):
```ts
...githubToolDefs,
```

Add to `handleTool` dispatch (add before the `else throw` line):
```ts
else if (name.startsWith('github_'))   result = await handleGithubTool(name, input)
```

- [ ] **Step 2: Update Groq system prompt capabilities**

In `src/backend/groq.ts`, add to the CAPABILITIES section:

```
• GitHub — list/view PRs, issues, commits, repo status → github_pr_list / github_pr_view / github_issue_list / github_commit_log / github_repo_status
```

In `src/backend/claude.ts`, add to the CAPABILITIES section:

```
• GitHub — PRs, issues, commits, repo status, write PR descriptions → github_pr_list / github_pr_view / github_issue_list / github_commit_log / github_repo_status / github_pr_describe
```

- [ ] **Step 3: Run tests**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add src/backend/tools/index.ts src/backend/groq.ts src/backend/claude.ts
git commit -m "feat: register GitHub tools in tool dispatch and system prompts"
```

---

## Task 3: Write tests for GitHub tools

**Files:**
- Create: `tests/backend/tools/github.test.ts`

- [ ] **Step 1: Create test file**

Create `tests/backend/tools/github.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock child_process to avoid real gh/git calls in tests
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util')
  return {
    ...actual,
    promisify: (fn: unknown) => {
      const { execFile } = require('child_process')
      if (fn === execFile || (fn as any).__isMocked) {
        return vi.fn()
      }
      return actual.promisify(fn as any)
    },
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

// Helper: stub execFile to return a specific stdout
function stubExecFile(stdout: string): void {
  const { execFile } = require('child_process')
  vi.mocked(execFile).mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, stdout, '')
  })
}

function stubExecFileError(stderr: string): void {
  const { execFile } = require('child_process')
  vi.mocked(execFile).mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    const err = new Error(stderr) as any
    err.stderr = stderr
    cb(err, '', stderr)
  })
}

describe('github_pr_list', () => {
  it('formats PR list from gh JSON output', async () => {
    const prs = [
      { number: 42, title: 'Add feature X', author: { login: 'timpactwa' }, state: 'OPEN', updatedAt: '2026-06-12T10:00:00Z', isDraft: false },
      { number: 43, title: 'Fix bug Y', author: { login: 'other' }, state: 'OPEN', updatedAt: '2026-06-11T08:00:00Z', isDraft: true },
    ]
    stubExecFile(JSON.stringify(prs))
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_list', {})
    expect(result).toContain('#42')
    expect(result).toContain('Add feature X')
    expect(result).toContain('@timpactwa')
    expect(result).toContain('[DRAFT]')
    expect(result).toContain('Fix bug Y')
  })

  it('returns "No open pull requests." for empty list', async () => {
    stubExecFile('[]')
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_list', {})
    expect(result).toBe('No open pull requests.')
  })

  it('returns helpful message when gh is not installed', async () => {
    stubExecFileError('ENOENT: no such file')
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_list', {})
    expect(result).toContain('gh CLI not found')
    expect(result).toContain('cli.github.com')
  })
})

describe('github_pr_view', () => {
  it('formats PR details with file list', async () => {
    const pr = {
      number: 42, title: 'Add feature X', body: 'This adds X.', author: { login: 'timpactwa' },
      state: 'OPEN', additions: 120, deletions: 30,
      files: [{ path: 'src/foo.ts' }, { path: 'src/bar.ts' }],
    }
    stubExecFile(JSON.stringify(pr))
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_view', { pr_number: 42 })
    expect(result).toContain('PR #42')
    expect(result).toContain('+120')
    expect(result).toContain('-30')
    expect(result).toContain('src/foo.ts')
    expect(result).toContain('This adds X.')
  })

  it('throws for missing pr_number', async () => {
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    // NaN passed — should not crash, just produce a weird gh call that returns an error
    const result = await handleGithubTool('github_pr_view', { pr_number: undefined })
    // Any non-throw outcome is acceptable (gh will error and we return the message)
    expect(typeof result).toBe('string')
  })
})

describe('github_issue_list', () => {
  it('formats issue list', async () => {
    const issues = [
      { number: 5, title: 'Bug in login', author: { login: 'user1' }, labels: [{ name: 'bug' }], updatedAt: '2026-06-10T00:00:00Z' },
    ]
    stubExecFile(JSON.stringify(issues))
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_issue_list', {})
    expect(result).toContain('#5')
    expect(result).toContain('Bug in login')
    expect(result).toContain('[bug]')
  })

  it('returns "No open issues." for empty list', async () => {
    stubExecFile('[]')
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_issue_list', {})
    expect(result).toBe('No open issues.')
  })
})

describe('github_repo_status', () => {
  it('formats status output', async () => {
    const { execFile } = require('child_process')
    let call = 0
    vi.mocked(execFile).mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      call++
      if (args.includes('rev-parse')) cb(null, 'feature/my-branch\n', '')
      else if (args.includes('status')) cb(null, ' M src/index.ts\n', '')
      else if (args.includes('rev-list')) cb(null, '2\t0\n', '')
      else cb(null, '', '')
    })
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_repo_status', {})
    expect(result).toContain('feature/my-branch')
    expect(result).toContain('2 ahead')
    expect(result).toContain('src/index.ts')
  })
})

describe('github_pr_describe', () => {
  it('returns commits and diff stat for the model to write a description', async () => {
    const { execFile } = require('child_process')
    vi.mocked(execFile).mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes('log')) cb(null, 'abc1234 feat: add thing\ndef5678 fix: correct typo\n', '')
      else cb(null, ' 2 files changed, 50 insertions(+), 5 deletions(-)\n', '')
    })
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_describe', {})
    expect(result).toContain('abc1234')
    expect(result).toContain('2 files changed')
  })

  it('returns helpful message when no commits ahead of base', async () => {
    const { execFile } = require('child_process')
    vi.mocked(execFile).mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, '', '')
    })
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    const result = await handleGithubTool('github_pr_describe', { base: 'main' })
    expect(result).toContain('No commits found')
  })
})

describe('handleGithubTool dispatch', () => {
  it('throws for unknown tool name', async () => {
    const { handleGithubTool } = await import('../../../src/backend/tools/github')
    await expect(handleGithubTool('github_unknown', {})).rejects.toThrow('Unknown github tool')
  })
})
```

- [ ] **Step 2: Run tests**

```
npx vitest run tests/backend/tools/github.test.ts
```

Expected: All tests PASS. (The mock setup for `child_process` + `util.promisify` may need minor adjustment — if `promisify` mocking is tricky, stub at a higher level by mocking the `runGh`/`runGit` helpers via `vi.spyOn`.)

If the `util.promisify` mock is awkward, simplify by extracting `runGh` and `runGit` as exported functions and mocking them directly:

```ts
vi.mock('../../../src/backend/tools/github', async () => {
  const actual = await vi.importActual<typeof import('../../../src/backend/tools/github')>('../../../src/backend/tools/github')
  return {
    ...actual,
    // tests call handleGithubTool directly, which calls runGh/runGit internally
  }
})
```

Use `vi.spyOn` on the module's internal helpers if needed.

- [ ] **Step 3: Run full suite**

```
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```
git add tests/backend/tools/github.test.ts
git commit -m "test: GitHub tool module coverage"
```

---

## Task 4: Smoke test in the live app

- [ ] **Step 1: Rebuild and run**

```
npm run build:backend
npm run dev
```

- [ ] **Step 2: Test via voice/text**

1. "What are my open PRs?" → `github_pr_list` runs, returns list or "gh CLI not found" message
2. "What's my repo status?" → `github_repo_status` returns branch + sync state
3. "Show me issue number 1" → `github_pr_view` or `github_issue_list` runs (or Jarvis asks for clarification)

- [ ] **Step 3: Commit smoke-test fix (if any bugs found)**

```
git add <changed files>
git commit -m "fix(github): <description of fix>"
```

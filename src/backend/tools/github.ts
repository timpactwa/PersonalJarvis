import { execFile } from 'child_process'
import { promisify } from 'util'
import { emitEvent } from '../events'
import type { GithubRow } from '../types'

const execFileAsync = promisify(execFile)

export const githubToolDefs = [
  {
    name: 'github_pr_list',
    description:
      'Lists OPEN pull requests for a GitHub repo (numbers, titles, authors, status) and also populates the GitHub panel\'s PRs tab. Use when the user asks "what PRs are open?", "show my pull requests", "what needs review?". For details/diff of ONE PR use github_pr_view; to draft a PR description use github_pr_describe.',
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
      'Gathers the current branch\'s commits and diff stat versus a base branch so you can write a professional PR title (≤72 chars) and body. Use when the user asks to "write a PR description", "describe my changes", or "draft a PR for this branch". Not available on the Groq provider (it is filtered out there) — only Claude can call it. Do NOT use to list or view existing PRs (use github_pr_list / github_pr_view).',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'A local repo directory path. Omit to use the current working directory.' },
        base: { type: 'string', description: 'Base branch to compare the current branch against (default "main").' },
      },
      required: [],
    },
  },
]

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

function isAuthError(out: string): boolean {
  return out.startsWith('gh CLI') || out.startsWith('Not auth') || out.startsWith('GitHub CLI')
}

function emitErrorRows(tab: 'STATUS' | 'PRs' | 'ISSUES' | 'COMMITS', message: string): void {
  try {
    emitEvent({ type: 'github_data', tab, rows: [{ title: message, badge: 'ERROR', badgeColor: '#ef4444' }] })
  } catch { /* non-critical */ }
}

async function prList(repo?: string, limit = 10): Promise<string> {
  const args = ['pr', 'list', ...repoArgs(repo), '--limit', String(limit), '--json',
    'number,title,author,state,updatedAt,isDraft']
  const out = await runGh(args)
  if (isAuthError(out)) {
    emitErrorRows('PRs', out)
    return out
  }

  try {
    const prs = JSON.parse(out) as Array<{
      number: number; title: string; author: { login: string }
      state: string; updatedAt: string; isDraft: boolean
    }>
    if (prs.length === 0) {
      emitEvent({ type: 'github_data', tab: 'PRs', rows: [] })
      return 'No open pull requests.'
    }
    const result = prs.map(pr =>
      `#${pr.number} ${pr.isDraft ? '[DRAFT] ' : ''}${pr.title}\n  by @${pr.author.login} · updated ${new Date(pr.updatedAt).toLocaleDateString()}`
    ).join('\n\n')
    try {
      const rows: GithubRow[] = prs.map(pr => ({
        title: `#${pr.number} ${pr.isDraft ? '[DRAFT] ' : ''}${pr.title}`,
        subtitle: pr.author?.login,
        meta: pr.updatedAt ? new Date(pr.updatedAt).toLocaleDateString() : undefined,
        badge: pr.state ?? 'OPEN',
        badgeColor: '#0ea5e9',
      }))
      emitEvent({ type: 'github_data', tab: 'PRs', rows })
    } catch { /* non-critical */ }
    return result
  } catch {
    emitErrorRows('PRs', out.slice(0, 80))
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
  if (isAuthError(out)) {
    emitErrorRows('ISSUES', out)
    return out
  }

  try {
    const issues = JSON.parse(out) as Array<{
      number: number; title: string; author: { login: string }
      labels: Array<{ name: string }>; updatedAt: string
    }>
    if (issues.length === 0) {
      emitEvent({ type: 'github_data', tab: 'ISSUES', rows: [] })
      return 'No open issues.'
    }
    const result = issues.map(i => {
      const labels = i.labels.map(l => l.name).join(', ')
      return `#${i.number} ${i.title}\n  by @${i.author.login}${labels ? ` · [${labels}]` : ''}`
    }).join('\n\n')
    try {
      const rows: GithubRow[] = issues.map(i => ({
        title: `#${i.number} ${i.title}`,
        subtitle: i.author?.login,
        meta: i.updatedAt ? new Date(i.updatedAt).toLocaleDateString() : undefined,
        badge: i.labels?.[0]?.name,
        badgeColor: '#f59e0b',
      }))
      emitEvent({ type: 'github_data', tab: 'ISSUES', rows })
    } catch { /* non-critical */ }
    return result
  } catch {
    emitErrorRows('ISSUES', out.slice(0, 80))
    return out
  }
}

async function commitLog(repo?: string, limit = 10): Promise<string> {
  const cwd = repo && !repo.includes('/') ? repo : undefined
  const repoSlug = repo?.includes('/') ? repo : undefined

  // Use git log with a parseable separator
  const result = await runGit(
    ['log', `--max-count=${limit}`, '--format=%H\x1f%h\x1f%s\x1f%an\x1f%ar', '--no-decorate'],
    cwd
  )

  try {
    const lines = result.split('\n').filter(Boolean)
    const rows: GithubRow[] = lines.slice(0, limit).map(line => {
      const [fullSha, shortSha, subject, author, relTime] = line.split('\x1f')
      const url = repoSlug ? `https://github.com/${repoSlug}/commit/${fullSha}` : undefined
      return {
        title: subject?.slice(0, 72) ?? line.slice(0, 72),
        subtitle: author,
        meta: `${shortSha} · ${relTime}`,
        badge: url ? 'VIEW' : undefined,
        badgeColor: url ? '#6366f1' : undefined,
      }
    })
    emitEvent({ type: 'github_data', tab: 'COMMITS', rows })
  } catch { /* non-critical */ }

  return result.replace(/\x1f/g, ' ')
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

  const result = [
    `Branch: ${branch}`,
    `Sync: ${syncStatus}`,
    status ? `Uncommitted changes:\n${status}` : 'Working tree clean',
  ].join('\n')
  try {
    const rows: GithubRow[] = [
      { title: `Branch: ${branch}`, badge: branch === 'main' || branch === 'master' ? 'MAIN' : 'BRANCH', badgeColor: '#10b981' },
      { title: syncStatus, badge: aheadCount !== '0' ? `↑${aheadCount}` : behindCount !== '0' ? `↓${behindCount}` : '✓', badgeColor: aheadCount !== '0' ? '#f59e0b' : '#10b981' },
      ...(status
        ? status.split('\n').filter(Boolean).slice(0, 6).map(line => ({
            title: line.trim().slice(0, 72),
            badge: line.startsWith('M') ? 'MODIFIED' : line.startsWith('?') ? 'UNTRACKED' : line.startsWith('A') ? 'ADDED' : undefined,
            badgeColor: '#6366f1',
          }))
        : [{ title: 'Working tree clean', badge: '✓', badgeColor: '#10b981' }]
      ),
    ]
    emitEvent({ type: 'github_data', tab: 'STATUS', rows })
  } catch { /* non-critical */ }
  return result
}

// `_repo` is accepted for call-signature symmetry with the other github tools,
// but pr_describe operates on the local working-tree git repo (via runGit), so a
// remote repo slug does not apply here.
async function prDescribe(_repo?: string, base = 'main'): Promise<string> {
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

export async function handleGithubTool(name: string, input: Record<string, unknown>): Promise<string> {
  const repo = input.repo ? String(input.repo) : undefined
  const limit = input.limit ? Number(input.limit) : undefined

  switch (name) {
    case 'github_pr_list':    return prList(repo, limit)
    case 'github_pr_view':    return prView(Number(input.pr_number), repo)
    case 'github_issue_list': return issueList(repo, input.label ? String(input.label) : undefined, limit)
    case 'github_commit_log': return commitLog(repo, limit)
    case 'github_repo_status': return repoStatus(repo)
    case 'github_pr_describe': return prDescribe(repo, input.base ? String(input.base) : 'main')
    default: throw new Error(`Unknown github tool: ${name}`)
  }
}

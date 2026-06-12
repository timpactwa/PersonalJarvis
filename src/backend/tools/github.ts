import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

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
      `.[0:${limit}] | .[] | "\\(.sha[0:7]) \\(.commit.message | split("\\n")[0]) — \\(.commit.author.name)"`,
    ]
    return runGh(args)
  }
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

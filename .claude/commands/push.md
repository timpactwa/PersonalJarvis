Scan the working tree for dangerous content, stage and commit all safe changes, then push.

This command runs the same safety scan and commit flow as /commit, then pushes to the remote.

## Step 1 — Status check

Run `git status` to see every changed/untracked file.

## Step 2 — Safety scan (MUST pass before anything is staged)

Check for the following. If ANY are found, STOP immediately, report exactly what was found and in which file, and do NOT stage, commit, or push anything.

**Blocked file names / paths (exact or glob):**
- `.env`, `.env.local`, `.env.*`, `.env.production`, `.env.development`
- `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*.cer`
- `*credentials*.json`, `.gmail-token.json`, `.gmail-credentials.json`
- Any file whose name contains `secret`, `password`, or `token` (case-insensitive)
- Files inside `secrets/`, `keys/`, `certs/` directories

**Blocked directories / artifacts:**
- `node_modules/`
- `dist/`, `dist-electron/`, `out/`, `build/`

**Blocked content patterns** — run `git diff HEAD` and scan for:
- Any line matching `(ANTHROPIC|OPENAI|GROQ|BRAVE|ELEVENLABS|STRIPE|TWILIO)_API_KEY\s*=\s*\S+`
- Any line matching `(SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*\S+`
- Strings starting with `sk-` followed by 20+ alphanumeric chars
- Strings matching `AKIA[A-Z0-9]{16}` (AWS access keys)
- OAuth tokens: `ya29\.`, `gho_`, `ghp_`, `github_pat_`

## Step 3 — If the scan is clean

1. Run `git add -A` to stage all changes.
2. Run `git diff --cached --stat` to summarise what will be committed.
3. Examine the staged diff (`git diff --cached`) to write an accurate commit message.
4. Craft a commit message: one short summary line (≤72 chars), blank line, then 1–3 bullet points if the diff is non-trivial.
5. Commit:

```
git commit -m "$(cat <<'EOF'
<summary line>

<optional detail bullets>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

## Step 4 — Push

1. Check current branch: `git branch --show-current`
2. If the branch is `main` or `master`: warn the user and ask for explicit confirmation before pushing. Do NOT force-push to main/master under any circumstances.
3. Otherwise: run `git push` (or `git push -u origin <branch>` if no upstream is set).
4. Report the push result including the remote URL and branch.

$ARGUMENTS

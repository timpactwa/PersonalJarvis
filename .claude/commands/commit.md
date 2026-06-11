Scan the working tree for dangerous content, then stage and commit all safe changes.

## Step 1 — Status check

Run `git status` to see every changed/untracked file.

## Step 2 — Safety scan (MUST pass before anything is staged)

Check for the following. If ANY are found, STOP immediately, report exactly what was found and in which file, and do NOT stage or commit anything.

**Blocked file names / paths (exact or glob):**
- `.env`, `.env.local`, `.env.*`, `.env.production`, `.env.development`
- `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*.cer`
- `*credentials*.json`, `.gmail-token.json`, `.gmail-credentials.json`
- Any file whose name contains `secret`, `password`, or `token` (case-insensitive)
- Files inside `secrets/`, `keys/`, `certs/` directories

**Blocked directories / artifacts (should never be committed):**
- `node_modules/`
- `dist/`, `dist-electron/`, `out/`, `build/`

**Blocked content patterns** — run `git diff HEAD` (or `git diff` for untracked files) and scan for these strings in the diff:
- Any line matching `(ANTHROPIC|OPENAI|GROQ|BRAVE|ELEVENLABS|STRIPE|TWILIO)_API_KEY\s*=\s*\S+`
- Any line matching `(SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*\S+`
- Strings starting with `sk-` followed by 20+ alphanumeric chars (OpenAI/Anthropic style keys)
- Strings matching `AKIA[A-Z0-9]{16}` (AWS access keys)
- OAuth tokens: `ya29\.`, `gho_`, `ghp_`, `github_pat_`

## Step 3 — If the scan is clean

1. Run `git add -A` to stage all changes.
2. Run `git diff --cached --stat` to show a final summary of what will be committed.
3. Examine the actual staged diff (`git diff --cached`) to write an accurate commit message.
4. Craft a commit message: one short summary line (≤72 chars), blank line, then 1–3 bullet points of key changes if the diff is non-trivial.
5. Commit with:

```
git commit -m "$(cat <<'EOF'
<summary line>

<optional detail bullets>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

6. Run `git status` to confirm the working tree is clean.

$ARGUMENTS

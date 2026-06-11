Run the full Vitest test suite, check for untested source files, and produce a clean report.

## Step 1 — Coverage check (before running tests)

Scan the project to detect any source files that have no corresponding test file.

- Source files live under `src/backend/**/*.ts` (excluding `index.ts` and `types.ts` which are integration/wiring files)
- Test files live under `tests/backend/**/*.test.ts`
- For each source file, a matching test file should exist at the corresponding path under `tests/backend/`
  - e.g. `src/backend/groq.ts` → `tests/backend/groq.test.ts`
  - e.g. `src/backend/tools/search.ts` → `tests/backend/tools/search.test.ts`
- List any source files that are **missing a test file** as "⚠ No tests: <path>"

## Step 2 — Run the suite

Run `npx vitest run` in the project root and capture all output.

## Step 3 — Report

Produce a report with this structure:

**Test results summary**
| Metric | Value |
|--------|-------|
| Test files | X passed / Y failed |
| Tests | X passed / Y failed |
| Duration | Xs |

**Failing tests** (only shown if there are failures)
For each failure:
- File path and test name
- The assertion error (one line — the `→ expected ... to be ...` line or the thrown message)
- Source location

**Untested source files** (from Step 1, if any)
- ⚠ No tests: `src/backend/foo.ts`

**All clear line** (only when everything passes and all files are covered)
- ✓ All N tests passed across M test files. No untested source files detected.

Do NOT dump the raw vitest output. Keep the report under 50 lines unless there are many failures.

$ARGUMENTS

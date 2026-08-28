---
name: tech-audit
description: Scan the codebase for outdated deps, type issues, code quality, test coverage, security patterns, Prisma query efficiency, bundle concerns, pattern adherence, architecture, and accessibility. Outputs a structured triage report.
argument-hint: '[--focus deps|types|quality|tests|security|bundle|patterns|api|routes|complexity|data-fetching|react|a11y|prisma|dead-code]'
context: fork
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - mcp__linear-server__list_issues
---

# Tech Audit

Perform a comprehensive codebase health audit across fifteen focus areas and produce a structured triage report.

## Arguments

- `--focus <area>`: Run only a specific audit area. Valid values: `deps`, `types`, `quality`, `tests`, `security`, `bundle`, `patterns`, `api`, `routes`, `complexity`, `data-fetching`, `react`, `a11y`, `prisma`, `dead-code`. If omitted, run all areas.

## Instructions

### 1. Parse arguments

Check if `--focus <area>` was passed. If so, run only that section plus section 17 (backlog cross-reference always runs, otherwise focused reruns re-propose tracked work). Otherwise run all sections in order.

---

## Core Checks

### 2. Dependencies

**Goal:** Identify outdated, vulnerable, or improperly pinned dependencies.

```bash
# Check for outdated packages
pnpm outdated 2>&1 || true

# Check for known vulnerabilities
pnpm audit 2>&1 || true
```

Also scan `package.json` for version ranges (`^` or `~` prefixes) — project convention requires exact versions.

```bash
grep -E '"\^|"~' package.json || echo "No version ranges found (good)"
```

Record findings: outdated count, vulnerability count, pinning violations.

### 3. Type safety

**Goal:** Surface type errors and `any` usage.

```bash
# Run TypeScript type checker
pnpm type-check 2>&1 || true
```

Scan for `any` usage in source files (excluding node_modules, .next, generated files):

```bash
grep -rn ': any\b\|as any\b\|<any>' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No 'any' usage found"
```

Record findings: type error count, `any` usage locations.

### 4. Code quality

**Goal:** Lint issues, leftover debug code, and TODO markers.

```bash
# Run ESLint
pnpm lint 2>&1 || true
```

Scan for quality markers:

```bash
# TODO/FIXME/HACK comments
grep -rn 'TODO\|FIXME\|HACK' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No TODO/FIXME/HACK found"

# console.log statements (should not be in production code)
grep -rn 'console\.log' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No console.log found"
```

Record findings: lint error count, TODO/FIXME/HACK count, console.log locations.

### 5. Test coverage

**Goal:** Measure test coverage and identify untested source files.

```bash
# Run tests with coverage
pnpm test:coverage 2>&1 || true
```

Find source files without corresponding test files:

Use Glob to find all `.ts` and `.tsx` files under `src/` (excluding test files, type declarations, and generated files). Then check which ones lack a corresponding `.test.ts(x)` sibling.

Record findings: coverage percentages, list of untested files.

### 6. Security

**Goal:** Check for common security anti-patterns.

Scan for:

```bash
# Hardcoded secrets or API keys (common patterns)
grep -rn 'apiKey\s*=\s*["'"'"']\|api_key\s*=\s*["'"'"']\|secret\s*=\s*["'"'"']\|password\s*=\s*["'"'"']' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No potential secrets found"

# Raw SQL queries (should use Prisma)
grep -rn '\$queryRaw\|\$executeRaw\|\.query(' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No raw SQL found"

# dangerouslySetInnerHTML
grep -rn 'dangerouslySetInnerHTML' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No dangerouslySetInnerHTML found"
```

Check auth protection on route pages:

There is no `(public)` route group in this project — the only group is `(legal)`. Treat these pages as intentionally public and skip them:

- `src/app/sign-in`, `sign-up`, `forgot-password`, `reset-password`
- `src/app/invite/[code]` (invite acceptance happens before sign-in)
- `src/app/(legal)/**` (`/privacy`, `/privacy/subprocessors`, `/terms`)
- `src/app/bot`, `src/app/status`

Also skip redirect-only pages whose body is just `redirect()` — `src/app/meal-plan` (→ `/`), `src/app/pantry` (→ `/shopping`), `src/app/household/invites` (→ `/household`) — they never render content.

For every other `page.tsx`, verify it (or its nearest `layout.tsx`) performs a session check. Match any of `getSession`, `auth.api.getSession`, or an import from `@/lib/session` — `src/lib/session.ts` exports the React-`cache`d `getSession` wrapper plus `getHasHousehold` / `getHouseholdIdForUser`:

```bash
find src/app -name 'page.tsx' \
  | grep -vE '/(sign-in|sign-up|forgot-password|reset-password|invite|\(legal\)|bot|status|meal-plan|pantry|household/invites)/' \
  | xargs grep -LE 'getSession|auth\.api\.getSession|@/lib/session'
```

Every file listed is a candidate unprotected route. Read it before flagging — the root `src/app/page.tsx` may branch on session state rather than redirect, and a page can inherit protection from a parent layout.

Check for client components importing server-only modules:

Use Grep to find files with `'use client'` that also import from `@/lib/prisma` or `@/lib/auth` (server-only modules).

Record findings: potential secret references, raw SQL usage, unprotected routes, boundary violations.

### 7. Bundle

**Goal:** Identify bundle size concerns.

Audit client components:

```bash
# Count 'use client' directives
grep -rn "'use client'" src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' -l || echo "No client components"
```

Check for large dependency imports in client components:

Use Grep to find client component files, then check if they import heavy libraries that could be tree-shaken or moved server-side. Derive the list from `package.json` dependencies (currently notable client-side: `posthog-js`, `ai`, `lucide-react`, `zod`).

Record findings: client component count, large import concerns.

### 8. Pattern adherence

**Goal:** Verify codebase follows CLAUDE.md conventions.

Check for raw HTML heading/paragraph elements instead of Typography components:

```bash
# Raw <h1>-<h4> or <p> tags in components (should use Heading/Body)
grep -rn '<h[1-4]\b\|<p\b' src/ --exclude-dir=generated --include='*.tsx' | grep -v 'node_modules\|\.test\.' || echo "No raw HTML typography found"
```

Check for layout classes on Typography components:

```bash
# Typography with layout classes (mt-, mb-, p-, mx-, etc.)
grep -rn '<Heading\|<Body\|<Blockquote' src/ --exclude-dir=generated --include='*.tsx' | grep -E 'className=.*\b(m[tblrxy]?-|p[tblrxy]?-|gap-)' || echo "No layout classes on Typography"
```

Check for relative imports (should use `@/` prefix):

```bash
grep -rn "from '\.\./\|from '\.\/" src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' | grep -v '\.test\.\|node_modules' || echo "No relative imports found"
```

Check for non-sentence-case UI text in common patterns:

```bash
# Button text with multiple capitalized words (potential Title Case violations)
grep -rn '<Button' src/ --exclude-dir=generated --include='*.tsx' | grep -oE '>([A-Z][a-z]+ ){2,}' || echo "No obvious title case violations"
```

Record findings: raw HTML elements, Typography layout violations, relative imports, casing issues.

---

## Architecture Checks

### 9. API consistency

**Goal:** Verify API routes follow consistent patterns for error handling, response shapes, and status codes.

Check error response shape consistency:

```bash
# Find all NextResponse.json calls with error-like content
grep -rn 'NextResponse.json' src/app/api/ --include='*.ts' | head -60
```

Read 3-4 representative API route files and compare:

- Do all routes wrap logic in try/catch?
- Are error responses a consistent shape (e.g., always `{ error: string }` or `{ error, details }`)?
- Are status codes used consistently (400 for validation, 401 for auth, 404 for not found, 500 for server errors)?
- Do all routes check authentication at the top?

Also check for routes missing try/catch entirely:

Use Grep to find `export async function (GET|POST|PUT|PATCH|DELETE)` handlers and verify each has a try/catch block.

Record findings: inconsistent error shapes, missing try/catch, inconsistent status codes, missing auth checks.

### 10. Route completeness

**Goal:** Identify route segments missing loading or error boundaries.

Find all `page.tsx` files and check for sibling `loading.tsx` and `error.tsx`:

```bash
# List all page.tsx files
find src/app -name 'page.tsx'
```

For each directory containing a `page.tsx`, check if `loading.tsx` and `error.tsx` exist in the same directory or a parent layout.

Focus on pages that do async data fetching (contain `await` in the component body) — these are the ones most likely to benefit from loading states.

Record findings: pages missing loading.tsx (especially async ones), pages missing error.tsx.

### 11. File complexity

**Goal:** Flag overly large files that may need extraction or refactoring.

```bash
# Find source files over 300 lines
find src/ -not -path '*/generated/*' \( -name '*.ts' -o -name '*.tsx' \) | grep -v node_modules | grep -v '.test.' | xargs wc -l | sort -rn | head -20
```

For the top files, note:

- Files over 300 lines: candidates for extraction
- Files over 500 lines: strong candidates for refactoring

Also check for deeply nested logic (multiple levels of if/else, ternaries):

```bash
# Functions with high indentation depth (rough proxy for complexity)
grep -rn '          ' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' | grep -v 'node_modules\|\.test\.\|\.css' | head -20
```

Record findings: file line counts, specific files over threshold, deeply nested code.

### 12. Data fetching patterns

**Goal:** Identify sequential data fetches in server components that could be parallelized.

Find server component pages (no `'use client'`) with multiple sequential `await` statements:

```bash
# Find page.tsx files with multiple await statements
grep -rn 'await ' src/app/ --include='page.tsx' -l
```

Read the top 5 page files and check for patterns like:

```typescript
// BAD: Sequential (waterfall)
const session = await getSession()
const mealPlan = await getMealPlan()
const pantry = await getPantry()

// GOOD: Parallel
const [session, mealPlan, pantry] = await Promise.all([
  getSession(),
  getMealPlan(),
  getPantry(),
])
```

Note: Some sequential fetches are intentional (e.g., session check before fetching user data). Only flag cases where the fetches are independent.

Record findings: pages with sequential independent fetches, suggested parallelization.

### 13. React patterns

**Goal:** Surface common React anti-patterns.

Check for useEffect without cleanup for subscriptions/listeners:

```bash
# useEffect calls that add event listeners but may lack cleanup
grep -rn 'useEffect' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' -l
```

Read files with useEffect and check for:

- **Missing cleanup:** Effects that add `addEventListener`, `setInterval`, `setTimeout`, or subscribe to external sources without returning a cleanup function
- **Missing dependencies:** Effects with `// eslint-disable-next-line react-hooks/exhaustive-deps` comments (suppressed dependency warnings)
- **Stale closures:** Effects with empty `[]` deps that reference state or props

Also check for clickable non-interactive elements:

```bash
# div/span with onClick (should usually be button)
grep -rn '<div.*onClick\|<span.*onClick' src/ --exclude-dir=generated --include='*.tsx' | grep -v '\.test\.' || echo "No clickable divs found"
```

Record findings: effects missing cleanup, suppressed hook warnings, clickable divs.

### 14. Accessibility

**Goal:** Identify common accessibility issues that can be detected statically.

```bash
# Images without alt text (next/image requires alt, but check for raw <img>)
grep -rn '<img' src/ --exclude-dir=generated --include='*.tsx' | grep -v 'alt=' | grep -v '\.test\.' || echo "No images without alt found"

# Icon-only buttons without accessible names
grep -rn '<Button' src/ --exclude-dir=generated --include='*.tsx' | grep -v 'aria-label\|sr-only\|>[A-Za-z]' || echo "No icon-only buttons without labels found"

# Missing form labels
grep -rn '<input\|<select\|<textarea' src/ --exclude-dir=generated --include='*.tsx' | grep -v 'aria-label\|id=.*\|\.test\.' | head -20
```

Also check for:

- Links without descriptive text (e.g., `<a>click here</a>`)
- Missing `aria-live` regions for dynamic content updates
- `tabIndex` values greater than 0 (anti-pattern)

```bash
# tabIndex anti-pattern
grep -rn 'tabIndex=["{][1-9]' src/ --exclude-dir=generated --include='*.tsx' || echo "No tabIndex anti-patterns"

# Generic link text
grep -rn '>click here<\|>here<\|>read more<' src/ --exclude-dir=generated --include='*.tsx' -i || echo "No generic link text found"
```

Record findings: images without alt, unlabeled buttons, missing form labels, tabIndex issues.

### 15. Prisma efficiency

**Goal:** Identify database query patterns that may cause performance issues.

```bash
# Find all Prisma query calls
grep -rn 'prisma\.' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' | grep -v 'node_modules\|\.test\.\|import\|type\|//' | head -40
```

Read files with Prisma queries and check for:

- **N+1 patterns:** A `findMany` followed by individual queries in a loop (should use `include` or a single query)
- **Missing `select`:** Queries that fetch entire records when only a few fields are needed (especially in list/index routes)
- **Missing `include`:** Queries that fetch a record, then separately query related data that could be included
- **Unbounded queries:** `findMany` without `take`/`limit` that could return thousands of rows

```bash
# findMany without take/limit
grep -rn 'findMany' src/ --exclude-dir=generated --include='*.ts' | grep -v 'take\|limit\|\.test\.' || echo "No unbounded findMany found"
```

Record findings: N+1 risks, missing select optimization, unbounded queries.

### 16. Dead code

**Goal:** Identify exported symbols that are never imported elsewhere.

Check for potentially unused exports:

```bash
# List all named exports from src/lib/ and src/components/
grep -rn '^export ' src/lib/ src/components/ --include='*.ts' --include='*.tsx' | grep -v '\.test\.\|node_modules\|export type\|export interface' | head -40
```

For each exported function/component/constant, search for imports:

Pick the 10 most suspicious exports (utilities, helpers, constants) and grep for their usage across the codebase. Flag any that have zero imports outside their own file.

Also check for unused local files:

```bash
# Files that might be orphaned (not imported anywhere)
# Check a few specific patterns
grep -rn "from '@/lib/" src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' | grep -oE "'@/lib/[^']+'" | sort -u
```

Compare the list of files in `src/lib/` against what's actually imported.

Record findings: unused exports, orphaned files.

### 17. Backlog cross-reference

**Goal:** Avoid proposing issues that already exist.

Use `mcp__linear-server__list_issues` with `team: "Honkadori"`, `limit: 100`, `fields: ['id', 'title', 'description', 'labels', 'status']`. Fetch `state: "Backlog"`, `"Todo"`, `"In Progress"`, and `"In Review"` in separate calls.

**Do not filter by `label: "Tech"`.** Accessibility, bug, and test-coverage proposals routinely duplicate issues that carry the `Bug` label or no label at all; a Tech-only fetch hides them and the audit re-proposes tracked work. Use the returned `labels` field to note which label the existing issue carries when classifying.

Classify each would-be proposal against returned titles/descriptions:

- **New** — no existing coverage
- **Duplicate of HON-XX** — already tracked
- **Update HON-XX** — tracked but description is stale

---

## Output Format

After running all applicable sections, compile the report:

```
## Tech Audit Report

**Date:** [current date]
**Scope:** [All areas / Focus: <area>]

### Summary

| Area | Status | Findings |
|------|--------|----------|
| Dependencies | [pass/warn/fail] | [brief summary] |
| Type Safety | [pass/warn/fail] | [brief summary] |
| Code Quality | [pass/warn/fail] | [brief summary] |
| Test Coverage | [pass/warn/fail] | [brief summary] |
| Security | [pass/warn/fail] | [brief summary] |
| Bundle | [pass/warn/fail] | [brief summary] |
| Patterns | [pass/warn/fail] | [brief summary] |
| API Consistency | [pass/warn/fail] | [brief summary] |
| Route Completeness | [pass/warn/fail] | [brief summary] |
| File Complexity | [pass/warn/fail] | [brief summary] |
| Data Fetching | [pass/warn/fail] | [brief summary] |
| React Patterns | [pass/warn/fail] | [brief summary] |
| Accessibility | [pass/warn/fail] | [brief summary] |
| Prisma Efficiency | [pass/warn/fail] | [brief summary] |
| Dead Code | [pass/warn/fail] | [brief summary] |

### Triage

#### Address Now
Items that should be fixed immediately (security issues, broken types, failing tests, accessibility blockers).

1. [Area] [Description] - `file:line` - [severity]
2. ...

#### Address Soon
Items to fix in the near term (outdated deps, missing tests, code quality, consistency issues).

1. [Area] [Description] - [severity]
2. ...

#### Monitor
Items to watch but not urgent (minor pattern deviations, informational).

1. [Area] [Description]
2. ...

### Detailed Findings

#### Dependencies
[Full output and analysis]

#### Type Safety
[Full output and analysis]

...

### Proposed Linear Issues
For significant findings, propose Linear issues. Each proposal is tagged with its section-17 status. This skill runs as a fork and cannot create issues — every **New** proposal must be a paste-ready block the caller can create verbatim, in "Writing for Agents" format (see CLAUDE.md), with plain-text `HON-NNN` references. All new issues include the **Tech** label.

#### 1. [Title] — New
**Label:** Tech · **Priority:** [Urgent/High/Medium/Low]
**What:** [Concrete change — file paths, functions, data shapes, expected behaviour]
**Why:** [The finding, its user or maintenance impact, and key constraints]
**Acceptance criteria:**
- [Observable, testable outcome]
- [Observable, testable outcome]

#### 2. [Title] — Update HON-XX
[What's changed since the issue was written; suggested priority change, if any]

#### 3. [Title] — Duplicate of HON-XX
[Optional comment to add to the existing issue]
```

### Triage criteria

- **Address Now**: Security vulnerabilities, type errors, failing tests, broken builds, auth gaps, accessibility blockers (missing alt text, no keyboard access), N+1 queries on hot paths, missing error boundaries on critical routes
- **Address Soon**: Outdated dependencies with available patches, missing test coverage for critical paths, code quality issues (console.log, TODO/FIXME), pattern violations, API inconsistencies, files over 500 lines, missing loading states, sequential fetches that should be parallel
- **Monitor**: Minor outdated deps without security impact, informational coverage gaps, style preferences, files 300-500 lines, minor React pattern concerns, unused exports in internal utilities

## Completion

After outputting the report, add the completion marker:

```
[tech-audit:complete] Audit finished - X findings (Y now, Z soon, W monitor)
```

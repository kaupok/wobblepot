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

Check if `--focus <area>` was passed. If so, run only that section plus sections 17 and 18 (backlog cross-reference always runs, otherwise focused reruns re-propose tracked work; confirm always runs). Otherwise run all sections in order.

---

## Core Checks

### 2. Dependencies

**Goal:** Identify outdated or improperly pinned dependencies. CI gates dependency advisories and lockfile pins (docs/DEPLOYMENT.md → Lockfile gates), so advisories are not audited here.

```bash
pnpm outdated 2>&1 || true
```

Also scan `package.json` for version ranges (`^` or `~` prefixes) — project convention requires exact versions.

```bash
grep -E '"\^|"~' package.json || echo "No version ranges found (good)"
```

Record findings: outdated count, pinning violations.

### 3. Type safety

CI runs `pnpm type-check`. Run it and read its output. Then scan for `any`, which no check counts:

```bash
grep -rn ': any\b\|as any\b\|<any>' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No 'any' usage found"
```

Record findings: type error count, `any` usage locations.

### 4. Code quality

CI runs `pnpm lint` (ESLint, `@shadcn/lint`, and `no-console` as a warning). Run it and read its output. Then count the markers no check counts:

```bash
grep -rn 'TODO\|FIXME\|HACK' src/ --exclude-dir=generated --include='*.ts' --include='*.tsx' || echo "No TODO/FIXME/HACK found"
```

Record findings: lint error and warning count, TODO/FIXME/HACK count.

### 5. Test coverage

CI gates coverage with `pnpm coverage:ratchet` (docs/DEPLOYMENT.md). It takes the base ref as its argument and compares the `coverage.thresholds` in `vitest.config.ts` with that ref's copy, so it needs no coverage run first:

```bash
git fetch origin main && pnpm coverage:ratchet origin/main
```

Then run `pnpm test:coverage 2>&1 || true` and read the summary. Name an untested file only from that summary (a file at or near 0% lines). Do not match test files by name: most files are covered by a test with another name.

Record findings: ratchet result, coverage percentages against the thresholds, files the summary shows as untested.

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

The public routes are `PUBLIC_ROUTES` in `src/proxy.ts`, which `src/proxy.test.ts` keeps current. Skip their pages, except `/admin`: it is there only so the proxy returns a 404, and its layout and pages still need a session check. Also skip redirect-only pages whose body is just `redirect()` (`src/app/meal-plan`). `src/app/pantry` renders the pantry, so it is checked.

For every other `page.tsx`, verify it (or its nearest `layout.tsx`) performs a session check. Match any of `getSession`, `auth.api.getSession`, an import from `@/lib/session`, `load-inventory` (`src/app/shopping/load-inventory.ts`, the session check for `/shopping` and `/pantry`), `requireAccountMember` (`src/app/account/account-member.ts`, each `/account` page) or `requireHouseholdMember` (`src/app/household/household-member.ts`, each `/household` page). List the pages with none, then drop the public ones:

```bash
find src/app -name 'page.tsx' | xargs grep -LE 'getSession|auth\.api\.getSession|@/lib/session|load-inventory|requireAccountMember|requireHouseholdMember'
```

Every file listed is a candidate unprotected route. Read it before flagging — the root `src/app/page.tsx` may branch on session state rather than redirect, and a page can inherit protection from a parent layout.

Check for client components importing server-only modules:

`pnpm prisma-boundary:check` (CI) catches an `@/lib/prisma` import outside `src/lib`; run it and read its output. Use Grep to find files with `'use client'` that import from `@/lib/auth`.

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

**Goal:** Verify codebase follows CLAUDE.md conventions. `pnpm lint` (section 4) already reports margins on type primitives and restyled primitives (`shadcn/no-restyle`).

Check for raw HTML heading/paragraph elements instead of Typography components:

```bash
# Raw <h1>-<h4> or <p> tags in components (should use Heading/Body)
grep -rn '<h[1-4]\b\|<p\b' src/ --exclude-dir=generated --include='*.tsx' | grep -v 'node_modules\|\.test\.' || echo "No raw HTML typography found"
```

Record findings: raw HTML elements.

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

CI runs `pnpm file-size:check` (5,000 tokens per code file, CLAUDE.md → Code Standards). Run it and read its output. `pnpm lint` (section 4) caps block nesting in `src/**` with `max-depth` (`eslint.config.mjs`), so nesting is not audited here.

Record findings: files over or near the cap.

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

Record findings: images without alt, missing form labels, tabIndex issues.

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
- **Unbounded queries:** `findMany` without `take`/`limit` that could return thousands of rows. Read the whole call: Prisma arguments span lines, so `take` is often lines below `findMany`.

Record findings: N+1 risks, missing select optimization, unbounded queries.

### 16. Dead code

CI runs `pnpm knip` (`knip.config.ts`), which fails on an unused file, export, type or dependency. Run it and read its output. A finding on `main` means the gate was bypassed; report it as **Address Soon**.

Record findings: knip's output.

### 17. Backlog cross-reference

**Goal:** Avoid proposing issues that already exist.

Use `mcp__linear-server__list_issues` with `team: "Wobblebot"`, `limit: 100`, `fields: ['id', 'title', 'description', 'labels', 'status']`. Fetch `state: "Backlog"`, `"Todo"`, `"Queued"`, `"In Progress"`, and `"In Review"` in separate calls.

**Do not filter by `label: "Tech"`.** Accessibility, bug, and test-coverage proposals routinely duplicate issues that carry the `Bug` label or no label at all; a Tech-only fetch hides them and the audit re-proposes tracked work. Use the returned `labels` field to note which label the existing issue carries when classifying.

**When the Linear MCP tools are not loaded in the fork,** read the same issues through the Linear GraphQL API, read-only, as `scripts/worktree-claude.sh` does: `LINEAR_API_KEY` from `.env`, sent bare in the `Authorization` header (no `Bearer`). Send queries only, never a mutation:

```bash
LINEAR_API_KEY=$(grep -E '^LINEAR_API_KEY=' .env | cut -d= -f2- | tr -d '"')
curl -s --max-time 30 -X POST https://api.linear.app/graphql \
  -H "Content-Type: application/json" -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query":"{ issues(first: 250, filter: { team: { key: { eq: \"HON\" } }, state: { type: { in: [\"backlog\", \"unstarted\", \"started\"] } } }) { nodes { identifier title description state { name } labels { nodes { name } } } } }"}'
```

If that fails too (no key, an error, no `data`), tag each proposal **Not cross-referenced** and say so at the top of the report.

Classify each would-be proposal against returned titles/descriptions:

- **New** — no existing coverage
- **Duplicate of HON-XX** — already tracked
- **Update HON-XX** — tracked but description is stale

### 18. Confirm findings

**Goal:** Report only findings that hold. The sections above sample files and grep for text, so a finding can be wrong or point at the wrong place.

For every finding that goes in the report, open the cited `file:line` and read the code around it:

- **Holds** — keep it.
- **Wrong file or line** — correct the citation, then keep it.
- **Wrong** (the code does not do what the finding says) — drop it.
- **By design** (CLAUDE.md, docs/PROJECT_SPEC.md or docs/AGENT_HISTORY.md says so) — drop it.

Put each dropped finding under **Rejected** with one line of reason.

For each section that sampled files (9 API consistency, 12 Data fetching, 13 React patterns, 15 Prisma efficiency, and any other that read a subset), count the files it read and the files it skipped. These go under **Not audited**.

---

## Output Format

After running all applicable sections, section 18 included, compile the report:

```
## Tech Audit Report

**Date:** [current date]
**Scope:** [All areas / Focus: <area>]
[Only if section 17 fell through: **Backlog not cross-referenced:** the Linear MCP tools and the GraphQL API both failed; every proposal is tagged Not cross-referenced.]

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
| Dead Code | [pass/fail] | [`pnpm knip` result] |

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

### Not audited

| Section | Files read | Files skipped | Skipped (paths, or how they were chosen) |
|---------|------------|---------------|------------------------------------------|
| API Consistency | [n] | [n] | [...] |

### Rejected

1. [Area] [Finding] - `file:line` - [Wrong / By design: one line of reason, naming the doc for by-design]
2. ...

### Proposed Linear Issues
For significant findings, propose Linear issues. Each proposal is tagged with its section-17 status. This skill runs as a fork and cannot create issues — every **New** proposal must be a paste-ready block the caller can create verbatim, per CLAUDE.md → Writing for Agents. All new issues include the **Tech** label.

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

#### 4. [Title] — Not cross-referenced
[The same paste-ready block as a New proposal; the caller checks Linear before filing]
```

### Triage criteria

- **Address Now**: Security vulnerabilities, type errors, failing tests, broken builds, auth gaps, accessibility blockers (missing alt text, no keyboard access), N+1 queries on hot paths, missing error boundaries on critical routes
- **Address Soon**: Outdated dependencies with available patches, missing test coverage for critical paths, code quality issues (console.log, TODO/FIXME), pattern violations, API inconsistencies, files over the file-size cap, `pnpm knip` findings, missing loading states, sequential fetches that should be parallel
- **Monitor**: Minor outdated deps without security impact, informational coverage gaps, style preferences, files near the file-size cap, minor React pattern concerns

## Completion

After outputting the report, add the completion marker:

```
[tech-audit:complete] Audit finished - X findings (Y now, Z soon, W monitor)
```

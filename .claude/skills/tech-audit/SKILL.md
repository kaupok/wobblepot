---
name: tech-audit
description: Scan the codebase for outdated deps, type issues, code quality, test coverage, security patterns, database health, bundle concerns, pattern adherence, architecture, and accessibility. Outputs a structured triage report.
argument-hint: '[--focus deps|types|quality|tests|security|database|bundle|patterns|api|routes|complexity|data-fetching|react|a11y|prisma|dead-code]'
context: fork
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - mcp__linear-server__list_issues
---

# Tech Audit

Perform a comprehensive codebase health audit across sixteen focus areas and produce a structured triage report.

## Arguments

- `--focus <area>`: Run only a specific audit area. Valid values: `deps`, `types`, `quality`, `tests`, `security`, `database`, `bundle`, `patterns`, `api`, `routes`, `complexity`, `data-fetching`, `react`, `a11y`, `prisma`, `dead-code`. If omitted, run all areas.

## Instructions

### 1. Parse arguments

Check if `--focus <area>` was passed. If so, run only that section. Otherwise run all sections in order.

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
grep -rn ': any\b\|as any\b\|<any>' src/ --include='*.ts' --include='*.tsx' || echo "No 'any' usage found"
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
grep -rn 'TODO\|FIXME\|HACK' src/ --include='*.ts' --include='*.tsx' || echo "No TODO/FIXME/HACK found"

# console.log statements (should not be in production code)
grep -rn 'console\.log' src/ --include='*.ts' --include='*.tsx' || echo "No console.log found"
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
grep -rn 'apiKey\s*=\s*["'"'"']\|api_key\s*=\s*["'"'"']\|secret\s*=\s*["'"'"']\|password\s*=\s*["'"'"']' src/ --include='*.ts' --include='*.tsx' || echo "No potential secrets found"

# Raw SQL queries (should use Prisma)
grep -rn '\$queryRaw\|\$executeRaw\|\.query(' src/ --include='*.ts' --include='*.tsx' || echo "No raw SQL found"

# dangerouslySetInnerHTML
grep -rn 'dangerouslySetInnerHTML' src/ --include='*.ts' --include='*.tsx' || echo "No dangerouslySetInnerHTML found"
```

Check auth protection on route pages:

Use Grep to find `page.tsx` files under `src/app/` that are not in `(public)` route groups, and verify they contain session checks (`getSession` or `auth.api`).

Check for client components importing server-only modules:

Use Grep to find files with `'use client'` that also import from `@/lib/prisma` or `@/lib/auth` (server-only modules).

Record findings: potential secret references, raw SQL usage, unprotected routes, boundary violations.

### 7. Bundle

**Goal:** Identify bundle size concerns.

Audit client components:

```bash
# Count 'use client' directives
grep -rn "'use client'" src/ --include='*.ts' --include='*.tsx' -l || echo "No client components"
```

Check for large dependency imports in client components:

Use Grep to find client component files, then check if they import heavy libraries (e.g., `date-fns`, `lodash`, `moment`, `zod`) that could be tree-shaken or moved server-side.

Check for barrel imports that might prevent tree-shaking:

```bash
grep -rn "from '@/components'" src/ --include='*.ts' --include='*.tsx' || echo "No barrel imports found"
```

Record findings: client component count, large import concerns, barrel import issues.

### 8. Pattern adherence

**Goal:** Verify codebase follows CLAUDE.md conventions.

Check for raw HTML heading/paragraph elements instead of Typography components:

```bash
# Raw <h1>-<h4> or <p> tags in components (should use Heading/Body)
grep -rn '<h[1-4]\b\|<p\b' src/ --include='*.tsx' | grep -v 'node_modules\|\.test\.' || echo "No raw HTML typography found"
```

Check for layout classes on Typography components:

```bash
# Typography with layout classes (mt-, mb-, p-, mx-, etc.)
grep -rn '<Heading\|<Body\|<Blockquote' src/ --include='*.tsx' | grep -E 'className=.*\b(m[tblrxy]?-|p[tblrxy]?-|gap-)' || echo "No layout classes on Typography"
```

Check for relative imports (should use `@/` prefix):

```bash
grep -rn "from '\.\./\|from '\.\/" src/ --include='*.ts' --include='*.tsx' | grep -v '\.test\.\|node_modules' || echo "No relative imports found"
```

Check for non-sentence-case UI text in common patterns:

```bash
# Button text with multiple capitalized words (potential Title Case violations)
grep -rn '<Button' src/ --include='*.tsx' | grep -oP '>([A-Z][a-z]+ ){2,}' || echo "No obvious title case violations"
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
find src/app -name 'page.tsx' -not -path '*/\(public\)/*'
```

For each directory containing a `page.tsx`, check if `loading.tsx` and `error.tsx` exist in the same directory or a parent layout.

Focus on pages that do async data fetching (contain `await` in the component body) — these are the ones most likely to benefit from loading states.

Record findings: pages missing loading.tsx (especially async ones), pages missing error.tsx.

### 11. File complexity

**Goal:** Flag overly large files that may need extraction or refactoring.

```bash
# Find source files over 300 lines
find src/ \( -name '*.ts' -o -name '*.tsx' \) | grep -v node_modules | grep -v '.test.' | xargs wc -l | sort -rn | head -20
```

For the top files, note:

- Files over 300 lines: candidates for extraction
- Files over 500 lines: strong candidates for refactoring

Also check for deeply nested logic (multiple levels of if/else, ternaries):

```bash
# Functions with high indentation depth (rough proxy for complexity)
grep -rn '          ' src/ --include='*.ts' --include='*.tsx' | grep -v 'node_modules\|\.test\.\|\.css' | head -20
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
grep -rn 'useEffect' src/ --include='*.ts' --include='*.tsx' -l
```

Read files with useEffect and check for:

- **Missing cleanup:** Effects that add `addEventListener`, `setInterval`, `setTimeout`, or subscribe to external sources without returning a cleanup function
- **Missing dependencies:** Effects with `// eslint-disable-next-line react-hooks/exhaustive-deps` comments (suppressed dependency warnings)
- **Stale closures:** Effects with empty `[]` deps that reference state or props

Also check for clickable non-interactive elements:

```bash
# div/span with onClick (should usually be button)
grep -rn '<div.*onClick\|<span.*onClick' src/ --include='*.tsx' | grep -v '\.test\.' || echo "No clickable divs found"
```

Record findings: effects missing cleanup, suppressed hook warnings, clickable divs.

### 14. Accessibility

**Goal:** Identify common accessibility issues that can be detected statically.

```bash
# Images without alt text (next/image requires alt, but check for raw <img>)
grep -rn '<img' src/ --include='*.tsx' | grep -v 'alt=' | grep -v '\.test\.' || echo "No images without alt found"

# Icon-only buttons without accessible names
grep -rn '<Button' src/ --include='*.tsx' | grep -v 'aria-label\|sr-only\|>[A-Za-z]' || echo "No icon-only buttons without labels found"

# Missing form labels
grep -rn '<input\|<select\|<textarea' src/ --include='*.tsx' | grep -v 'aria-label\|id=.*\|\.test\.' | head -20
```

Also check for:

- Links without descriptive text (e.g., `<a>click here</a>`)
- Missing `aria-live` regions for dynamic content updates
- `tabIndex` values greater than 0 (anti-pattern)

```bash
# tabIndex anti-pattern
grep -rn 'tabIndex=["{][1-9]' src/ --include='*.tsx' || echo "No tabIndex anti-patterns"

# Generic link text
grep -rn '>click here<\|>here<\|>read more<' src/ --include='*.tsx' -i || echo "No generic link text found"
```

Record findings: images without alt, unlabeled buttons, missing form labels, tabIndex issues.

### 15. Prisma efficiency

**Goal:** Identify database query patterns that may cause performance issues.

```bash
# Find all Prisma query calls
grep -rn 'prisma\.' src/ --include='*.ts' --include='*.tsx' | grep -v 'node_modules\|\.test\.\|import\|type\|//' | head -40
```

Read files with Prisma queries and check for:

- **N+1 patterns:** A `findMany` followed by individual queries in a loop (should use `include` or a single query)
- **Missing `select`:** Queries that fetch entire records when only a few fields are needed (especially in list/index routes)
- **Missing `include`:** Queries that fetch a record, then separately query related data that could be included
- **Unbounded queries:** `findMany` without `take`/`limit` that could return thousands of rows

```bash
# findMany without take/limit
grep -rn 'findMany' src/ --include='*.ts' | grep -v 'take\|limit\|\.test\.' || echo "No unbounded findMany found"
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
grep -rn "from '@/lib/" src/ --include='*.ts' --include='*.tsx' | grep -oP "'@/lib/[^']+'" | sort -u
```

Compare the list of files in `src/lib/` against what's actually imported.

Record findings: unused exports, orphaned files.

### 17. Backlog cross-reference

**Goal:** Avoid proposing issues that already exist.

Use `mcp__linear-server__list_issues` with `team: "Honkadori"`, `label: "Tech"`, `limit: 100`. Fetch `state: "Backlog"`, `"Todo"`, and `"In Progress"` in separate calls.

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
| Database | [pass/warn/fail] | [brief summary] |
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
For significant findings, propose Linear issues. Each proposal is tagged with its section-17 status. All new issues must include the **Tech** label.

1. **[Title]** - New - [Description] - [Priority] - Label: Tech
2. **[Title]** - Update HON-XX - [What's changed]
3. **[Title]** - Duplicate of HON-XX - [Optional comment to add]
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

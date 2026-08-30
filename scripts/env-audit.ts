/**
 * Vercel env-var drift audit (HON-550)
 *
 * Surfaces environment variables that are configured in Vercel but no longer
 * referenced anywhere in this repo — dead config left behind when a temporary
 * `FEATURE_*` gate (or any other var) was retired from the code but never
 * removed from the dashboard. See docs/FEATURE_FLAGS.md § "Retiring an
 * env-var flag" for the manual checklist this verifies.
 *
 * Direction matters. An earlier design compared Vercel against the `env.ts`
 * schema; that produces 12 false positives, because `env.ts` is only one of
 * several consumers of the environment — `prisma/seed.ts`, `scripts/*.sh` and
 * `.github/workflows/*` read `process.env` directly. So instead we take each
 * name Vercel has and ask whether the repo references it *at all*, using
 * `git grep` as the reference oracle.
 *
 * Two tiers are reported:
 *   ORPHAN    — the name appears nowhere in the repo. Almost certainly dead.
 *   DOC-ONLY  — the name appears only in Markdown / `.env*`, never in code.
 *               Catches a half-retired flag whose doc mention was left behind.
 *
 * Read-only: this never mutates Vercel. Deletion stays a manual dashboard step.
 *
 * Usage: pnpm env:audit [--strict]
 *   --strict  exit 1 when ORPHANs are found (default is warn-only, exit 0)
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// ============================================
// IGNORE LIST
// ============================================

/**
 * Names written by Vercel Marketplace integrations. We neither read nor own
 * these, and deleting them would break the integration — so an absent code
 * reference is expected, not drift.
 */
const INTEGRATION_MANAGED: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^UPSTASH_KV_/,
    why: 'Injected by the Upstash Marketplace integration; our code reads the manually-set UPSTASH_REDIS_REST_* names instead (see src/lib/env.ts).',
  },
  {
    pattern: /^UPSTASH_REDIS_URL$/,
    why: 'Injected by the Upstash Marketplace integration alongside UPSTASH_KV_*; not read by our code.',
  },
]

export function ignoreReason(name: string): string | null {
  return INTEGRATION_MANAGED.find((e) => e.pattern.test(name))?.why ?? null
}

// ============================================
// TYPES
// ============================================

export interface VercelVar {
  name: string
  /** Environment labels, e.g. ['Production', 'Preview', 'staging']. */
  environments: string[]
}

export type Tier = 'ORPHAN' | 'DOC-ONLY'

export interface Finding {
  name: string
  tier: Tier
  environments: string[]
  /** Files the name was found in — empty for ORPHAN. */
  files: string[]
}

// ============================================
// VERCEL SIDE
// ============================================

const VERCEL_API = 'https://api.vercel.com'

/** Safety stop so a misbehaving cursor can't spin forever. */
const MAX_ENV_PAGES = 20

/**
 * CI path: the REST API, driven purely by secrets. `.vercel/` is gitignored,
 * so there is no committed project file to read identity from — CI must pass
 * VERCEL_TOKEN + VERCEL_PROJECT_ID (+ VERCEL_ORG_ID for team-scoped projects).
 */
async function fetchFromApi(
  token: string,
  projectId: string,
  orgId?: string,
): Promise<VercelVar[]> {
  const team = orgId ? `?teamId=${encodeURIComponent(orgId)}` : ''
  const headers = { Authorization: `Bearer ${token}` }

  // Paginated. Stopping at page one would silently shrink the set we audit,
  // so a genuine orphan on a later page would never be reported.
  const envs: { key: string; target?: string[]; customEnvironmentIds?: string[] }[] = []
  let until: number | undefined
  for (let page = 0; page < MAX_ENV_PAGES; page++) {
    const cursor = until === undefined ? '' : `${team ? '&' : '?'}until=${until}`
    const res = await fetch(
      `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}/env${team}${cursor}`,
      { headers },
    )
    if (!res.ok) {
      throw new Error(`Vercel API ${res.status} ${res.statusText}: ${await res.text()}`)
    }
    const body = (await res.json()) as {
      envs?: { key: string; target?: string[]; customEnvironmentIds?: string[] }[]
      pagination?: { next?: number | null }
    }
    envs.push(...(body.envs ?? []))

    const next = body.pagination?.next
    if (next === undefined || next === null) break
    until = next
  }

  // Custom environments (e.g. "staging") come back as opaque ids; resolve them
  // to slugs so the report is readable. Non-fatal if the call is unavailable.
  const customNames = await fetchCustomEnvironments(headers, projectId, team)

  const byName = new Map<string, Set<string>>()
  for (const env of envs) {
    const labels = [
      ...(env.target ?? []),
      ...(env.customEnvironmentIds ?? []).map((id) => customNames.get(id) ?? `custom:${id}`),
    ]
    const set = byName.get(env.key) ?? new Set<string>()
    labels.forEach((l) => set.add(l))
    byName.set(env.key, set)
  }
  return [...byName].map(([name, envs]) => ({ name, environments: [...envs].sort() }))
}

async function fetchCustomEnvironments(
  headers: Record<string, string>,
  projectId: string,
  team: string,
): Promise<Map<string, string>> {
  try {
    const res = await fetch(
      `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}/custom-environments${team}`,
      { headers },
    )
    if (!res.ok) return new Map()
    const body = (await res.json()) as { environments?: { id: string; slug?: string }[] }
    return new Map((body.environments ?? []).map((e) => [e.id, e.slug ?? e.id]))
  } catch {
    return new Map()
  }
}

/**
 * Local path: the linked CLI. `vercel env ls` has no --json flag (checked on
 * CLI 54.7.1), so we parse its table — columns are separated by 2+ spaces:
 *
 *   NAME    Encrypted    Production, Preview, staging    3d ago
 *   NAME    Encrypted    Preview (some/git-branch)       4m ago
 */
function fetchFromCli(): VercelVar[] {
  const stdout = execFileSync('vercel', ['env', 'ls'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 10 * 1024 * 1024,
  })

  const byName = new Map<string, Set<string>>()
  for (const line of stdout.split('\n')) {
    const cols = line.trim().split(/ {2,}/)
    const name = cols[0]
    const environments = cols[2]
    if (name === undefined || environments === undefined) continue
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue // skips the header and rules

    const set = byName.get(name) ?? new Set<string>()
    environments
      .split(',')
      .map((e) => e.replace(/\s*\(.*\)\s*$/, '').trim()) // drop "(git/branch)"
      .filter(Boolean)
      .forEach((e) => set.add(e))
    byName.set(name, set)
  }

  if (byName.size === 0) {
    throw new Error('Parsed no variables from `vercel env ls` — is this project linked?')
  }
  return [...byName].map(([name, envs]) => ({ name, environments: [...envs].sort() }))
}

async function getVercelVars(): Promise<{ vars: VercelVar[]; source: string }> {
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  const orgId = process.env.VERCEL_ORG_ID

  if (token && projectId) {
    return { vars: await fetchFromApi(token, projectId, orgId), source: 'Vercel REST API' }
  }
  if (token && !projectId) {
    throw new Error('VERCEL_TOKEN is set but VERCEL_PROJECT_ID is not — both are required in CI.')
  }
  return { vars: fetchFromCli(), source: '`vercel env ls` (linked CLI)' }
}

// ============================================
// REPO SIDE
// ============================================

/**
 * Vendored upstream skill docs are not our configuration — a var mentioned
 * only there is not evidence that we use it.
 */
const SCAN_PATHSPEC = [':(exclude).agents/']

/** Markdown and `.env*` files document a var; they don't consume it. */
export function isDocFile(file: string): boolean {
  return file.endsWith('.md') || /(^|\/)\.env/.test(file)
}

/**
 * Files referencing `name`, searched across tracked files only. `-w` matters:
 * without it `DATABASE_URL` would match `DATABASE_URL_UNPOOLED` and mask a
 * genuine orphan. Underscore counts as a word character, so the two stay
 * distinct.
 */
function referencesFor(name: string): string[] {
  try {
    const stdout = execFileSync(
      'git',
      ['grep', '--files-with-matches', '-I', '-w', '-F', '-e', name, '--', ...SCAN_PATHSPEC],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 10 * 1024 * 1024 },
    )
    return stdout.split('\n').filter(Boolean)
  } catch (error: unknown) {
    // git grep: 0 = found, 1 = no match, >1 = failure. Swallowing a failure
    // here would report every variable as an ORPHAN — a false-positive flood
    // that `--strict` would turn into a red build. Only exit 1 means "absent".
    if ((error as { status?: number }).status === 1) return []
    throw new Error(`git grep failed for ${name} (exit ${(error as { status?: number }).status})`)
  }
}

// ============================================
// AUDIT
// ============================================

export function audit(
  vars: VercelVar[],
  resolve: (name: string) => string[] = referencesFor,
): { findings: Finding[]; ignored: string[] } {
  const findings: Finding[] = []
  const ignored: string[] = []

  for (const v of vars) {
    if (ignoreReason(v.name)) {
      ignored.push(v.name)
      continue
    }
    const files = resolve(v.name)
    if (files.length === 0) {
      findings.push({ name: v.name, tier: 'ORPHAN', environments: v.environments, files })
    } else if (files.every(isDocFile)) {
      findings.push({ name: v.name, tier: 'DOC-ONLY', environments: v.environments, files })
    }
  }

  return { findings, ignored }
}

// ============================================
// REPORT
// ============================================

function report(findings: Finding[], vars: VercelVar[], ignored: string[], source: string): void {
  console.log(`\nVercel env-var drift audit — ${vars.length} variables via ${source}`)
  if (ignored.length > 0) {
    console.log(`Skipped ${ignored.length} integration-managed: ${ignored.sort().join(', ')}`)
  }

  if (findings.length === 0) {
    console.log('\n✓ No drift. Every Vercel variable is referenced in code.\n')
    return
  }

  // Grouped per environment so a var live in Production but dead in
  // Development is visible as such.
  const environments = [...new Set(findings.flatMap((f) => f.environments))].sort()

  for (const env of environments) {
    const inEnv = findings.filter((f) => f.environments.includes(env))
    console.log(`\n${env}`)
    for (const f of inEnv.sort((a, b) => a.name.localeCompare(b.name))) {
      const detail = f.tier === 'DOC-ONLY' ? ` — referenced only in ${f.files.join(', ')}` : ''
      console.log(`  ${f.tier.padEnd(8)} ${f.name}${detail}`)
    }
  }

  const orphans = findings.filter((f) => f.tier === 'ORPHAN').length
  const docOnly = findings.length - orphans
  console.log(`\n${orphans} orphan(s), ${docOnly} doc-only.`)
  console.log('Remove confirmed dead vars via Vercel → Settings → Environment Variables.')
  console.log('See docs/FEATURE_FLAGS.md § "Retiring an env-var flag".\n')
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict')

  const { vars, source } = await getVercelVars()
  const { findings, ignored } = audit(vars)
  report(findings, vars, ignored, source)

  if (strict && findings.some((f) => f.tier === 'ORPHAN')) {
    process.exitCode = 1
  }
}

// Guarded so the unit test can import the pure helpers without shelling out
// to the Vercel CLI.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(`\nenv-audit failed: ${error instanceof Error ? error.message : String(error)}`)
    console.error(
      'Locally, run `vercel link` first. In CI, set VERCEL_TOKEN and VERCEL_PROJECT_ID.\n',
    )
    process.exitCode = 1
  })
}

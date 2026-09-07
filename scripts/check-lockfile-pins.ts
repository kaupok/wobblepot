/**
 * Targeted lockfile pin assertions (HON-595)
 *
 * `pnpm audit --audit-level critical` in CI catches a new *critical* advisory,
 * but it cannot catch the advisories we already cleared by hand: those were
 * high/moderate, and 33 transitive highs remain on `main`, so the audit
 * threshold cannot be lowered to reach them. This script is the other half of
 * that gate — it asserts the specific resolutions HON-588 cleared are still in
 * place.
 *
 * Why they need asserting at all: HON-588 cleared `defu@6.1.4` (high,
 * prototype pollution via `__proto__`, on the `better-auth > defu` production
 * auth path) purely by *lockfile dedupe* onto `6.1.7`. No spec changed —
 * `better-auth@1.7.2` still declares `defu: ^6.1.4`, so `6.1.4` remains a legal
 * resolution. A lockfile merge conflict resolved by regeneration, or any
 * `pnpm update` touching the better-auth subtree, can put it back with zero
 * signal. A dedupe is not a pin; this file is what makes it one.
 *
 * The fix for a violation is to re-dedupe (`pnpm update <package>`), NOT to add
 * a `pnpm.overrides` block: HON-588 rejected an override explicitly, because
 * in-range resolution succeeds and an override hides the underlying spec rather
 * than detecting drift.
 *
 * This is a plain text scan of `pnpm-lock.yaml`, deliberately — no `pnpm` API
 * call, no network, no lockfile-schema coupling beyond the `name@version`
 * token itself.
 *
 * Usage: pnpm lockfile:check [path/to/pnpm-lock.yaml]
 *   The path defaults to the repo-root lockfile, resolved from this file's own
 *   location so it does not depend on the working directory. The argument
 *   exists so the unit test can feed a deliberately bad fixture.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ============================================
// PIN LIST
// ============================================

/**
 * One entry per resolution we cleared by hand and now depend on staying
 * cleared. Every entry carries a `why` naming the advisory and the issue that
 * cleared it — an assertion nobody can explain is an assertion nobody can
 * safely update.
 *
 * **Prefer `minimum`.** Advisories publish a *range* and a patched floor, so a
 * pin that names one point on that range leaves its neighbours green: banning
 * `uuid@10.0.0` alone does nothing about `uuid@9.0.1` or `uuid@11.0.0`, which
 * carry the identical advisory. `minimum` states the published floor instead,
 * so it covers the whole range and does not go stale when a patch ships.
 * `banned` is for a range that really is a single version (GHSA-w5hq's
 * `>= 12.0.0, < 12.0.1`) or for a whole release line via the `4.0.` prefix
 * form.
 *
 * `package` accepts a `@scope/*` glob. A `banned` `version` ending in `.`
 * matches a whole release line by prefix (`4.0.` covers 4.0.0 through 4.0.18).
 *
 * Ranges below are from `gh api '/advisories?ecosystem=npm&affects=<pkg>'`,
 * checked 2026-09-07 — not from memory. Re-check them when editing an entry.
 */
export type Pin =
  | {
      /** Fail if this exact version (or release line) resolves at all. */
      kind: 'banned'
      package: string
      version: string
      why: string
    }
  | {
      /** Fail if any resolved version sorts below this patched floor. */
      kind: 'minimum'
      package: string
      version: string
      why: string
    }
  | {
      /** Fail if more than one distinct version of this package resolves. */
      kind: 'single'
      package: string
      why: string
    }

export const PINS: Pin[] = [
  {
    kind: 'minimum',
    package: 'defu',
    version: '6.1.5',
    why: 'GHSA-737v-mqg7-c878 (high — prototype pollution via __proto__), affected <= 6.1.4, patched 6.1.5. Reached on the better-auth > defu production auth path. HON-588 cleared it by deduping onto 6.1.7, and better-auth@1.7.2 still declares "defu: ^6.1.4", so 6.1.4 stays a legal resolution. The floor, not the single banned version, is what covers the whole affected range.',
  },
  {
    kind: 'single',
    package: 'defu',
    why: 'HON-588 fixed defu by lockfile dedupe, so a second resolved version means the dedupe came undone even when both versions are patched — the condition that let the advisory in once. Fix: pnpm update defu. This is a hygiene assertion, not an advisory one; the floor above is what covers the advisory.',
  },
  {
    kind: 'minimum',
    package: 'uuid',
    version: '11.1.1',
    why: "GHSA-w5hq-g745-h8pq (moderate — missing buffer bounds check in v3/v5/v6 when `buf` is provided), affected < 11.1.1, patched 11.1.1. Reached via resend > svix > uuid; HON-588 cleared uuid@10.0.0 by bumping resend to 6.25.0, which pulls a newer svix. svix's uuid range is not ours to control, so the floor covers 9.x and 11.0.x too — no uuid entry resolves at all today.",
  },
  {
    kind: 'banned',
    package: 'uuid',
    version: '12.0.0',
    why: 'GHSA-w5hq-g745-h8pq again, affected >= 12.0.0 < 12.0.1, patched 12.0.1. That range is the single version 12.0.0, which sorts above the 11.1.1 floor above and so needs its own entry.',
  },
  {
    kind: 'banned',
    package: 'uuid',
    version: '13.0.0',
    why: 'GHSA-w5hq-g745-h8pq again, affected >= 13.0.0 < 13.0.1, patched 13.0.1. Same shape as the 12.0.0 entry — a one-version range above the floor.',
  },
  {
    kind: 'minimum',
    package: 'vitest',
    version: '4.1.0',
    why: "GHSA-5xrq-8626-4rwp (critical — Vitest UI server allows arbitrary file read and execute), affected >= 4.0.0 < 4.1.0, patched 4.1.0. Filed against the `vitest` package itself, which the @vitest/* glob below does NOT match, so this entry is what actually asserts HON-588's 4.0.18 -> 4.1.11 move. The floor also catches a downgrade to the affected 3.x and earlier lines.",
  },
  {
    kind: 'minimum',
    package: '@vitest/browser',
    version: '4.1.10',
    why: 'The highest patched floor of the three Browser Mode criticals: GHSA-2h32-95rg-cppp (otelCarrier query param served as inline script, < 4.1.6), GHSA-g8mr-85jm-7xhm (exposed Browser Mode API can proxy CDP and overwrite files, <= 4.1.7) and GHSA-p63j-vcc4-9vmv (provider commands bypass file-access restrictions, < 4.1.10). Named explicitly rather than via the @vitest/* glob, because a glob floor would fire on @vitest/expect@3.2.4, which legitimately resolves from a separate transitive line. @vitest/browser is transitive (via @vitest/browser-playwright), so nothing in package.json pins it.',
  },
  {
    kind: 'banned',
    package: '@vitest/*',
    version: '4.0.',
    why: 'Backstop for the rest of the scoped toolchain: HON-588 moved the whole vitest 4.0.x line to 4.1.11, so any scoped @vitest package back on 4.0.x means the toolchain was downgraded even where no advisory names that package. Only the 4.0.x line is banned — @vitest/expect@3.2.4 and friends legitimately resolve from a separate transitive line. HON-640 raises the vitest and @vitest/browser floors above when vitest 5 lands; update those entries, do not delete them.',
  },
]

// ============================================
// SCAN
// ============================================

/**
 * Every `name@version` token in the lockfile, mapped to the first line it
 * appears on.
 *
 * Deliberately not restricted to the 2-space `packages:` / `snapshots:` keys.
 * A resolution can also appear only inside a peer suffix — e.g.
 * `better-auth@1.7.2(...)(vitest@4.1.11)` — and a guard that can be evaded by
 * where the string happens to land is not a guard. Over-matching is harmless
 * here: the pin list names a handful of packages explicitly, so a token that is
 * not one of them is never consulted.
 *
 * `specifier: ^6.1.4` lines carry no `name@version` token and are ignored for
 * free — the version must be preceded by `@` and a package name.
 */
export function parseLockfileVersions(text: string): Map<string, Map<string, number>> {
  // Scoped or bare package name, then `@`, then a version starting with a
  // digit. The version runs to the first character that cannot be part of one:
  // whitespace, a peer-suffix paren, a YAML colon, or a quote.
  //
  // The leading lookbehind stops a match from starting mid-identifier, so
  // `@vitest/browser@4.1.11` yields the scoped name rather than `browser`.
  const token = /(?<![\w.@/-])((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@(\d[^\s():'"]*)/gi

  const found = new Map<string, Map<string, number>>()
  // Prefix line-start offsets so a match index converts to a line number
  // without re-scanning the file for every hit.
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1)
  }

  for (const match of text.matchAll(token)) {
    const name = match[1]
    const version = match[2]
    if (name === undefined || version === undefined) continue

    let versions = found.get(name)
    if (versions === undefined) {
      versions = new Map<string, number>()
      found.set(name, versions)
    }
    if (!versions.has(version)) {
      versions.set(version, lineNumberAt(lineStarts, match.index))
    }
  }

  return found
}

/** 1-based line number for a character offset, by binary search. */
function lineNumberAt(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const start = lineStarts[mid]
    if (start !== undefined && start <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

/** `@scope/*` matches every package in the scope; anything else is exact. */
export function matchesPackage(pattern: string, name: string): boolean {
  return pattern.endsWith('/*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern
}

/** A pattern ending in `.` matches a release line by prefix; else exact. */
export function matchesVersion(pattern: string, version: string): boolean {
  return pattern.endsWith('.') ? version.startsWith(pattern) : version === pattern
}

/**
 * Numeric compare on the major.minor.patch core, so a `minimum` pin can state
 * the floor an advisory actually publishes rather than one point on its range.
 *
 * String comparison is not an option here: `'4.1.9' > '4.1.10'` lexically,
 * which is exactly the boundary the @vitest/browser floor sits on. Build
 * metadata is ignored and a prerelease sorts below its release, per semver.
 */
export function compareVersions(a: string, b: string): number {
  const core = (v: string): number[] =>
    (v.split('-')[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0)

  const left = core(a)
  const right = core(b)
  for (let i = 0; i < 3; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta !== 0) return delta
  }

  // 4.1.10-beta.1 < 4.1.10 — a prerelease of the floor is still below it.
  const isRelease = (v: string) => (v.includes('-') ? 0 : 1)
  return isRelease(a) - isRelease(b)
}

export interface Violation {
  pin: Pin
  /** Human-readable statement of what was found, without the `why`. */
  detail: string
}

export function findViolations(
  versions: Map<string, Map<string, number>>,
  pins: Pin[] = PINS,
): Violation[] {
  const violations: Violation[] = []

  for (const pin of pins) {
    for (const [name, resolved] of versions) {
      if (!matchesPackage(pin.package, name)) continue

      if (pin.kind === 'single') {
        if (resolved.size > 1) {
          const listed = [...resolved.keys()].sort().join(', ')
          violations.push({
            pin,
            detail: `${name} resolves to ${resolved.size} versions: ${listed}`,
          })
        }
        continue
      }

      if (pin.kind === 'minimum') {
        for (const [version, line] of resolved) {
          if (compareVersions(version, pin.version) < 0) {
            violations.push({
              pin,
              detail: `${name}@${version} (line ${line}) is below the patched floor ${pin.version}`,
            })
          }
        }
        continue
      }

      for (const [version, line] of resolved) {
        if (matchesVersion(pin.version, version)) {
          violations.push({ pin, detail: `${name}@${version} (line ${line})` })
        }
      }
    }
  }

  return violations
}

export function formatViolation({ pin, detail }: Violation): string {
  return `  ✗ ${detail}\n    ${pin.why}`
}

// ============================================
// MAIN
// ============================================

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Smallest number of distinct packages a real lockfile for this repo can hold.
 * It currently resolves ~1200, so this is a truncation tripwire, not a floor
 * anyone has to maintain.
 */
const MIN_PLAUSIBLE_PACKAGES = 50

export function checkLockfile(lockfilePath: string): Violation[] {
  const text = readFileSync(lockfilePath, 'utf8')
  const versions = parseLockfileVersions(text)

  // An empty, truncated or wrong-format file resolves no packages, so no pin
  // can fire and the script would print "N pin(s) hold" over nothing — a green
  // check that proves the opposite of what it claims. Refuse to pass on it.
  if (!text.includes('lockfileVersion:') || versions.size < MIN_PLAUSIBLE_PACKAGES) {
    throw new Error(
      `${lockfilePath} does not look like a pnpm lockfile ` +
        `(${versions.size} package(s) resolved, expected at least ${MIN_PLAUSIBLE_PACKAGES}). ` +
        'Refusing to report the pins as holding against a file the scan cannot read.',
    )
  }

  return findViolations(versions)
}

function main(): void {
  const lockfilePath = process.argv[2] ?? path.join(repoRoot, 'pnpm-lock.yaml')
  // Relative only when it reads better than the absolute path — a lockfile
  // outside the cwd (the unit test's fixture) otherwise prints as `../../../…`.
  const relative = path.relative(process.cwd(), lockfilePath)
  const label = relative === '' || relative.startsWith('..') ? lockfilePath : relative
  const violations = checkLockfile(lockfilePath)

  if (violations.length === 0) {
    // Say what was checked, so a green step proves the scan ran rather than
    // that it silently found no lockfile to read.
    console.log(`✓ ${label}: ${PINS.length} pin(s) hold.`)
    return
  }

  console.error(`\n✗ ${label}: ${violations.length} pin violation(s)\n`)
  for (const violation of violations) {
    console.error(formatViolation(violation))
    console.error('')
  }
  console.error(
    'Each line above states what resolved and why that resolution is pinned — read\n' +
      'the reason before deciding what to do, since not every pin is an advisory\n' +
      '(the defu single-version rule is a dedupe-hygiene check). Fix by re-deduping\n' +
      'the offending package (`pnpm update <package>`) or by upgrading the dependency\n' +
      'that pulls it. Do NOT add a `pnpm.overrides` entry — HON-588 rejected that\n' +
      'deliberately: in-range resolution succeeds, and an override hides the\n' +
      'underlying spec instead of detecting drift.\n' +
      'See scripts/check-lockfile-pins.ts for the pin list and its rationale.\n',
  )
  process.exitCode = 1
}

// Guarded so the unit test can import the pure helpers without running the scan.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    main()
  } catch (error: unknown) {
    console.error(
      `\ncheck-lockfile-pins failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}

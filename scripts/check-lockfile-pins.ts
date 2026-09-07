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
 * `package` accepts a `@scope/*` glob. `version` ending in `.` matches a whole
 * release line by prefix (`4.0.` covers 4.0.0 through 4.0.18).
 */
export type Pin =
  | {
      /** Fail if this exact version (or version line) resolves at all. */
      kind: 'banned'
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
    kind: 'single',
    package: 'defu',
    why: 'HON-588 cleared defu@6.1.4 (high — prototype pollution via __proto__, on the better-auth > defu production auth path) by deduping onto 6.1.7. better-auth@1.7.2 still declares "defu: ^6.1.4", so a second resolved version means the dedupe came undone. Fix: pnpm update defu.',
  },
  {
    kind: 'banned',
    package: 'defu',
    version: '6.1.4',
    why: 'High — prototype pollution via __proto__ on the better-auth > defu production auth path, cleared in HON-588. Banned outright, not just as a duplicate, so it cannot come back as the sole resolution.',
  },
  {
    kind: 'banned',
    package: 'uuid',
    version: '10.0.0',
    why: 'Moderate — missing buffer bounds check, reached via resend > svix > uuid. Cleared in HON-588 by bumping resend to 6.25.0, which pulls a newer svix. No uuid entry is in the lockfile at all today.',
  },
  {
    kind: 'banned',
    package: '@vitest/*',
    version: '4.0.',
    why: 'The vitest 4.0.x line carried four criticals (UI server arbitrary file read/execute; Browser Mode otelCarrier inline script; Browser Mode API CDP proxy / file overwrite; provider commands bypass file-access restrictions), cleared in HON-588 by pinning the toolchain to 4.1.11. Only the 4.0.x line is banned: @vitest/expect@3.2.4 and friends legitimately resolve from a separate transitive line. HON-640 raises this floor when vitest 5 lands — update the entry, do not delete it.',
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
 * here: the pin list is an explicit allow-nothing list of four packages, so a
 * token that is not one of them is never consulted.
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
    'These are advisories that were cleared by hand and have regressed. Fix by\n' +
      're-deduping the offending package (`pnpm update <package>`) or by upgrading\n' +
      'the dependency that pulls it. Do NOT add a `pnpm.overrides` entry — HON-588\n' +
      'rejected that deliberately: in-range resolution succeeds, and an override\n' +
      'hides the underlying spec instead of detecting drift.\n' +
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

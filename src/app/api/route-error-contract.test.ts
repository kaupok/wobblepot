import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Contract test for HON-570.
 *
 * `apiFetch` (`src/lib/api.ts`) parses every non-2xx response as JSON and
 * surfaces the `error` field as the user-facing message. A handler that lets
 * an exception escape gets Next.js's default 500, which is not `{ error }` —
 * so the user sees a parse-level failure instead of a mapped message.
 *
 * The original audit compared per-file handler counts against `try {` counts,
 * which silently passed handlers whose only `try` wrapped `await request.json()`.
 * This test walks each handler body instead, so that class of gap can't come back.
 */

const API_DIR = join(process.cwd(), 'src/app/api')

/**
 * Routes exempt from the `{ error }` contract, with the reason. Keep this list
 * short and justified — an entry is a deliberate carve-out, not a TODO.
 */
const EXEMPT: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'auth/[...all]/route.ts',
    why: "Better Auth's own handler via toNextJsHandler(). It owns the error shape for /api/auth/*, and the client reads it through authClient + auth-errors.ts, not apiFetch.",
  },
]

function routeFiles(dir: string, prefix = ''): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      found.push(...routeFiles(join(dir, entry.name), rel))
    } else if (entry.name === 'route.ts') {
      found.push(rel)
    }
  }
  return found
}

interface Handler {
  method: string
  /** 1-indexed line of the function declaration, for the failure message. */
  line: number
  body: string[]
}

/**
 * Collect every handler reachable from a route file's exports — both the direct
 * `export async function GET()` form and the `export const POST = withRequestId(handlePOST)`
 * form used by the AI routes, which the naive grep can't see through.
 */
function handlersIn(lines: string[]): Handler[] {
  const handlers: Handler[] = []

  const bodyAt = (declLine: number): string[] => {
    // Handler bodies are Prettier-formatted, so the closing brace of a
    // top-level function is the first line that is exactly `}`.
    const end = lines.findIndex((l, i) => i > declLine && l === '}')
    return lines.slice(declLine + 1, end)
  }

  lines.forEach((line, i) => {
    const [, directMethod] = /^export async function (GET|POST|PUT|PATCH|DELETE)\b/.exec(line) ?? []
    if (directMethod) {
      handlers.push({ method: directMethod, line: i + 1, body: bodyAt(i) })
      return
    }

    const [, wrappedMethod, inner] =
      /^export const (GET|POST|PUT|PATCH|DELETE) = \w+\((\w+)\)/.exec(line) ?? []
    if (wrappedMethod && inner) {
      const declLine = lines.findIndex((l) => l.startsWith(`async function ${inner}(`))
      if (declLine !== -1) {
        handlers.push({ method: wrappedMethod, line: declLine + 1, body: bodyAt(declLine) })
      }
    }
  })

  return handlers
}

/** Returns a failure reason, or null when the handler body is properly guarded. */
function unguardedReason(body: string[]): string | null {
  const hasTry = body.some((l) => l === '  try {')
  const lastCatch = body.reduce((last, l, i) => (/^ {2}\} catch\b/.test(l) ? i : last), -1)

  if (!hasTry || lastCatch === -1) return 'no top-level try/catch'

  // Everything after the last top-level `} catch` must belong to that catch
  // block. Anything else means work runs outside the guard.
  const after = body.slice(lastCatch + 1)
  const close = after.indexOf('  }')
  if (close === -1) return 'top-level catch block never closes'
  if (after.slice(0, close).some((l) => l.trim() && !l.startsWith('    '))) {
    return 'statements escape the top-level catch block'
  }
  if (after.slice(close + 1).some((l) => l.trim())) {
    return 'code runs after the top-level catch block'
  }
  return null
}

describe('API route error contract', () => {
  const files = routeFiles(API_DIR).filter((f) => !EXEMPT.some((e) => e.file === f))

  it('finds the route files to check', () => {
    // Guards against the walker silently matching nothing and the suite
    // passing vacuously.
    expect(files.length).toBeGreaterThan(30)
  })

  it.each(files)('%s wraps every exported handler in try/catch', (file) => {
    const lines = readFileSync(join(API_DIR, file), 'utf8').split('\n')
    const handlers = handlersIn(lines)

    expect(handlers.length).toBeGreaterThan(0)

    const unguarded = handlers
      .map((h) => {
        const reason = unguardedReason(h.body)
        return reason ? `${h.method} (line ${h.line}): ${reason}` : null
      })
      .filter((r): r is string => r !== null)

    // A handler that throws must still answer `{ error: string }` at 500 —
    // see the file header for why the shape, not just the status, matters.
    expect(unguarded).toEqual([])
  })
})

/**
 * `CHECKOUT_CODE_PATHS` in `scripts/orchestrator.sh` lists the files that run
 * out of the main checkout, so a commit to one of them on origin/main raises
 * "WARN Checkout is behind origin/main". A file the orchestrator or
 * `worktree-claude.sh` sources runs from the checkout too, so it must be in the
 * list (HON-1416: `worktree-auto-run.sh` and `wt-stop-check.sh` were not).
 *
 * Reads the scripts as text and follows `source "$SCRIPT_DIR/…"` (or
 * `. "$SCRIPT_DIR/…"`) through every sourced file, so the next file split
 * cannot open the same gap.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const ENTRY_SCRIPTS = ['orchestrator.sh', 'worktree-claude.sh', 'worktree-auto-run.sh']
const SOURCE_LINE = /^[ \t]*(?:source|\.)[ \t]+"\$SCRIPT_DIR\/([\w.-]+)"/gm

function sourcedBy(script: string): string[] {
  const text = fs.readFileSync(path.join(scriptsDir, script), 'utf8')
  return [...text.matchAll(SOURCE_LINE)].map((match) => match[1] ?? '')
}

function sourcedFromCheckout(): Set<string> {
  const seen = new Set<string>()
  const queue = [...ENTRY_SCRIPTS]
  while (queue.length > 0) {
    for (const file of sourcedBy(queue.shift()!)) {
      if (seen.has(file)) continue
      seen.add(file)
      queue.push(file)
    }
  }
  return seen
}

function checkoutCodePaths(): string[] {
  const text = fs.readFileSync(path.join(scriptsDir, 'orchestrator.sh'), 'utf8')
  const list = text.match(/^CHECKOUT_CODE_PATHS=\(([^)]*)\)/m)?.[1]
  if (list === undefined)
    throw new Error('CHECKOUT_CODE_PATHS=( … ) not found in scripts/orchestrator.sh')
  return list.trim().split(/\s+/)
}

describe('CHECKOUT_CODE_PATHS (HON-1416)', () => {
  it('finds the source lines it checks', () => {
    // A regex that matched nothing would pass the coverage test below on an empty set.
    const sourced = sourcedFromCheckout()
    expect(sourced).toContain('models.sh')
    expect(sourced).toContain('worktree-auto-run.sh')
    expect(sourced).toContain('wt-stop-check.sh')
  })

  it('lists every script that orchestrator.sh or worktree-claude.sh sources', () => {
    const listed = checkoutCodePaths()
    const missing = [...sourcedFromCheckout()]
      .map((file) => `scripts/${file}`)
      .filter((file) => !listed.includes(file))
    expect(missing).toEqual([])
  })

  it('lists the entry scripts themselves', () => {
    const listed = checkoutCodePaths()
    expect(listed).toContain('scripts/orchestrator.sh')
    expect(listed).toContain('scripts/worktree-claude.sh')
  })
})

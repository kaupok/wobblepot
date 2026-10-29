/**
 * Shared helpers for the tests that read scripts/pr-review.sh as text:
 * review-checklist-gate.test.ts and review-checklist-gate.pr-body.test.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const prReview = path.join(repoRoot, 'scripts/pr-review.sh')

export const read = (file: string) => fs.readFileSync(file, 'utf8')

/** One shell line lifted from the script, matched by how it starts. */
export function lineStartingWith(prefix: string): string {
  const line = read(prReview)
    .split('\n')
    .find((l) => l.startsWith(prefix))
  if (!line) throw new Error(`scripts/pr-review.sh no longer has a line starting ${prefix}`)
  return line
}

/** The body of one appended heredoc, bounded at its terminator. */
export function heredoc(name: string): string {
  const source = read(prReview)
  const start = source.indexOf(`<<'${name}'`)
  if (start === -1) throw new Error(`scripts/pr-review.sh no longer appends ${name}`)
  const end = source.indexOf(`\n${name}\n`, start + 1)
  if (end === -1) throw new Error(`${name} heredoc is unterminated`)
  return source.slice(start, end)
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * CLAUDE.md loads into every session, and it regrows because each incident
 * adds a paragraph and nothing removes one (HON-786 trimmed it to about 5,700
 * words; two weeks later it was 6,700). HON-1187 cut it to 3,000 and set this
 * gate 10% above that.
 *
 * Raise MAX_WORDS only on purpose, in a PR that says why.
 */
const MAX_WORDS = 3300

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Words as `wc -w` counts them: runs of non-whitespace. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** The failure message for a text over the limit, or null when it fits. */
function sizeViolation(text: string): string | null {
  const words = countWords(text)
  if (words <= MAX_WORDS) return null
  return (
    `CLAUDE.md is ${words} words; the limit is ${MAX_WORDS}.\n` +
    'Move a section that applies to one task into the skill or doc that task reads, ' +
    'and leave a one-line pointer. Do not shorten sentences to fit: the rule and its ' +
    'reason move together. See docs/AGENT_HISTORY.md → Steering file size.'
  )
}

describe('countWords', () => {
  it('counts runs of non-whitespace, as wc -w does', () => {
    expect(countWords('  one two\n\tthree  `four|five` |\n')).toBe(5)
  })

  it('counts an empty text as zero', () => {
    expect(countWords('\n \n')).toBe(0)
  })
})

describe('sizeViolation', () => {
  it('fails a 3,400-word CLAUDE.md and says to move content, not to shorten it', () => {
    const message = sizeViolation('word '.repeat(3400))
    expect(message).toContain('CLAUDE.md is 3400 words; the limit is 3300.')
    expect(message).toContain('Move a section')
    expect(message).toContain('Do not shorten sentences')
  })

  it('passes a text exactly at the limit', () => {
    expect(sizeViolation('word '.repeat(3300))).toBeNull()
  })
})

describe('CLAUDE.md', () => {
  it('stays within the steering-file word limit', () => {
    const text = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8')
    const violation = sizeViolation(text)
    if (violation) expect.fail(violation)
  })
})

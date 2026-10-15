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
 * /auto-implement's SKILL.md loads once per unattended run and grew the same
 * way, to 9,933 words (9,128 once HON-1190 moved its shell into scripts).
 * HON-1230 moved its incident history into
 * `.claude/skills/auto-implement/history.md`, cut it under 3,000, and capped
 * it here at the same limit.
 *
 * Raise a limit only on purpose, in a PR that says why.
 */
const STEERING_FILES = [
  {
    file: 'CLAUDE.md',
    maxWords: 3300,
    advice: 'Move a section that applies to one task into the skill or doc that task reads',
  },
  {
    file: '.claude/skills/auto-implement/SKILL.md',
    maxWords: 3300,
    advice:
      'Move the incident or reason behind a rule into .claude/skills/auto-implement/history.md, ' +
      'or a rarely-taken branch into a sibling file',
  },
] as const

type SteeringFile = (typeof STEERING_FILES)[number]

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Words as `wc -w` counts them: runs of non-whitespace. */
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** The failure message for a text over the file's limit, or null when it fits. */
function sizeViolation(text: string, { file, maxWords, advice }: SteeringFile): string | null {
  const words = countWords(text)
  if (words <= maxWords) return null
  return (
    `${file} is ${words} words; the limit is ${maxWords}.\n` +
    `${advice}, and leave a one-line pointer. Do not shorten sentences to fit: the rule and its ` +
    'reason move together. See docs/AGENT_HISTORY.md → Steering file size.'
  )
}

const [claudeMd, autoImplementSkill] = STEERING_FILES

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
    const message = sizeViolation('word '.repeat(3400), claudeMd)
    expect(message).toContain('CLAUDE.md is 3400 words; the limit is 3300.')
    expect(message).toContain('Move a section')
    expect(message).toContain('Do not shorten sentences')
  })

  it('fails a 3,301-word auto-implement SKILL.md and points at history.md', () => {
    const message = sizeViolation('word '.repeat(3301), autoImplementSkill)
    expect(message).toContain(
      '.claude/skills/auto-implement/SKILL.md is 3301 words; the limit is 3300.',
    )
    expect(message).toContain('.claude/skills/auto-implement/history.md')
    expect(message).toContain('Do not shorten sentences')
  })

  it('passes a text exactly at the limit', () => {
    expect(sizeViolation('word '.repeat(3300), claudeMd)).toBeNull()
    expect(sizeViolation('word '.repeat(3300), autoImplementSkill)).toBeNull()
  })
})

describe.each(STEERING_FILES)('$file', (steering) => {
  it('stays within the steering-file word limit', () => {
    const text = fs.readFileSync(path.join(repoRoot, steering.file), 'utf8')
    const violation = sizeViolation(text, steering)
    if (violation) expect.fail(violation)
  })
})

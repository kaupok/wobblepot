import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

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
 * Every other skill grows the same way, so HON-1235 capped each project
 * SKILL.md at that limit too and cut /plan-issue, then 3,690 words, under it.
 *
 * `.claude/rules/*.md` is the third kind (HON-1303). A path-scoped rule loads
 * on every Read, Write or Edit of a matching file, so it reaches unattended
 * workers that read no doc, and it is where per-area rules go now that
 * CLAUDE.md is at its cap (3,185 words and 235 lines against Claude Code's
 * 200-line target on 2026-10-23). It loads often, so its cap is lower.
 *
 * Raise a limit only on purpose, in a PR that says why.
 */
const MAX_WORDS = 3300
const RULE_MAX_WORDS = 1000

/** Upstream copies, updated by re-copying them, so a local cut would be lost. */
const VENDOR_SKILLS = ['better-auth-best-practices', 'create-auth-skill', 'next-upgrade']

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsDir = path.join(repoRoot, '.claude/skills')
const rulesDir = path.join(repoRoot, '.claude/rules')

interface SteeringFile {
  file: string
  maxWords: number
  advice: string
}

/**
 * The project skills: every `.claude/skills/<name>/SKILL.md` but the vendor copies.
 * A skill can be a symlink (the vendor copies are), so this checks for the
 * SKILL.md, which follows the link, rather than for a directory entry.
 */
function projectSkills(): string[] {
  return fs
    .readdirSync(skillsDir)
    .filter((name) => !VENDOR_SKILLS.includes(name))
    .filter((name) => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort()
}

function skillSteeringFile(skill: string): SteeringFile {
  return {
    file: `.claude/skills/${skill}/SKILL.md`,
    maxWords: MAX_WORDS,
    advice:
      `Move the incident or reason behind a rule into .claude/skills/${skill}/history.md, ` +
      'or a rarely-taken branch into a sibling file',
  }
}

const claudeMd: SteeringFile = {
  file: 'CLAUDE.md',
  maxWords: MAX_WORDS,
  advice: 'Move a section that applies to one task into the skill or doc that task reads',
}

/**
 * Every `.md` under `dir`, recursively, as Claude Code discovers rules: a rule
 * in a subdirectory loads like one at the top. Absolute paths, sorted.
 * `statSync` follows a symlinked rules directory, which Claude Code loads too.
 * A missing directory returns nothing, so the `toContain` assertion below
 * names the problem instead of the whole file dying at import.
 */
function ruleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .flatMap((name) => {
      const full = path.join(dir, name)
      if (fs.statSync(full).isDirectory()) return ruleFiles(full)
      return name.endsWith('.md') ? [full] : []
    })
    .sort()
}

function ruleSteeringFile(file: string): SteeringFile {
  return {
    file: path.relative(repoRoot, file),
    maxWords: RULE_MAX_WORDS,
    advice:
      'Split the rule file by concern, or move a rule that is not needed on every touch of a ' +
      'matching file into the doc that task reads',
  }
}

const STEERING_FILES: SteeringFile[] = [
  claudeMd,
  ...projectSkills().map(skillSteeringFile),
  ...ruleFiles(rulesDir).map(ruleSteeringFile),
]

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

describe('countWords', () => {
  it('counts runs of non-whitespace, as wc -w does', () => {
    expect(countWords('  one two\n\tthree  `four|five` |\n')).toBe(5)
  })

  it('counts an empty text as zero', () => {
    expect(countWords('\n \n')).toBe(0)
  })
})

describe('STEERING_FILES', () => {
  const files = STEERING_FILES.map((steering) => steering.file)

  const limitsUnder = (prefix: string) =>
    new Set(STEERING_FILES.filter((s) => s.file.startsWith(prefix)).map((s) => s.maxWords))

  it('caps CLAUDE.md and the project skills at 3,300 words', () => {
    expect(files).toContain('CLAUDE.md')
    expect(files).toContain('.claude/skills/auto-implement/SKILL.md')
    expect(files).toContain('.claude/skills/plan-issue/SKILL.md')
    expect(claudeMd.maxWords).toBe(3300)
    expect(limitsUnder('.claude/skills/')).toEqual(new Set([3300]))
  })

  it('caps every rule file at 1,000 words', () => {
    expect(files).toContain('.claude/rules/code.md')
    expect(limitsUnder('.claude/rules/')).toEqual(new Set([1000]))
  })

  it('leaves out the vendor skills', () => {
    expect(files).not.toContain('.claude/skills/better-auth-best-practices/SKILL.md')
    expect(files).not.toContain('.claude/skills/create-auth-skill/SKILL.md')
    expect(files).not.toContain('.claude/skills/next-upgrade/SKILL.md')
  })

  // A vendor skill that was renamed or deleted would leave a dead exclusion,
  // and a project skill reusing the name would go uncapped.
  it.each(VENDOR_SKILLS)('excludes %s, which still exists', (skill) => {
    expect(fs.existsSync(path.join(skillsDir, skill, 'SKILL.md'))).toBe(true)
  })
})

describe('ruleFiles', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'steering-rules-'))
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('finds .md files in subdirectories and skips other files', () => {
    fs.mkdirSync(path.join(tmp, 'sub'))
    fs.writeFileSync(path.join(tmp, 'b.md'), '')
    fs.writeFileSync(path.join(tmp, 'sub', 'a.md'), '')
    fs.writeFileSync(path.join(tmp, 'notes.txt'), '')
    expect(ruleFiles(tmp)).toEqual([path.join(tmp, 'b.md'), path.join(tmp, 'sub', 'a.md')])
  })

  it('returns nothing for a missing directory', () => {
    expect(ruleFiles(path.join(tmp, 'missing'))).toEqual([])
  })
})

describe('sizeViolation', () => {
  it('fails a 3,400-word CLAUDE.md and says to move content, not to shorten it', () => {
    const message = sizeViolation('word '.repeat(3400), claudeMd)
    expect(message).toContain('CLAUDE.md is 3400 words; the limit is 3300.')
    expect(message).toContain('Move a section')
    expect(message).toContain('Do not shorten sentences')
  })

  it("fails a 3,301-word skill and points at that skill's history.md", () => {
    const message = sizeViolation('word '.repeat(3301), skillSteeringFile('plan-issue'))
    expect(message).toContain(
      '.claude/skills/plan-issue/SKILL.md is 3301 words; the limit is 3300.',
    )
    expect(message).toContain('.claude/skills/plan-issue/history.md')
    expect(message).toContain('a rarely-taken branch into a sibling file')
    expect(message).toContain('Do not shorten sentences')
  })

  it('fails a 1,001-word rule file and says to split it', () => {
    const rule = ruleSteeringFile(path.join(rulesDir, 'code.md'))
    const message = sizeViolation('word '.repeat(1001), rule)
    expect(message).toContain('.claude/rules/code.md is 1001 words; the limit is 1000.')
    expect(message).toContain('Split the rule file by concern')
    expect(message).toContain('Do not shorten sentences')
  })

  it('passes a text exactly at the limit', () => {
    expect(sizeViolation('word '.repeat(3300), claudeMd)).toBeNull()
    expect(sizeViolation('word '.repeat(3300), skillSteeringFile('plan-issue'))).toBeNull()
    expect(
      sizeViolation('word '.repeat(1000), ruleSteeringFile(path.join(rulesDir, 'code.md'))),
    ).toBeNull()
  })
})

describe.each(STEERING_FILES)('$file', (steering) => {
  it('stays within the steering-file word limit', () => {
    const text = fs.readFileSync(path.join(repoRoot, steering.file), 'utf8')
    const violation = sizeViolation(text, steering)
    if (violation) expect.fail(violation)
  })
})

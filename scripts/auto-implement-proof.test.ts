/**
 * The proof the /auto-implement Linear summary asks for (HON-1236).
 *
 * The 7.4 summary is the cycle's last word on "done", so the template and the step
 * that fills it must agree. Moved out of review-checklist-gate.test.ts (HON-1260),
 * which checks the reviewer prompt; these tests read only the skill's own files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const read = (file: string) => fs.readFileSync(file, 'utf8')

// HON-1236: the Linear summary is the cycle's last word on "done". Without a proof line
// per criterion it is self-report, so the template and the step that fills it must agree.
describe('Linear summary proof', () => {
  const skillDir = path.join(repoRoot, '.claude/skills/auto-implement')

  it('gives the 7.4 template a Proof section with the three labels', () => {
    const templates = read(path.join(skillDir, 'templates.md'))
    const summary = templates.slice(templates.indexOf('## Linear summary comment (7.4)'))
    expect(summary).toContain('### Proof')
    for (const label of ['measured:', 'inferred:', 'not proven:']) {
      expect(summary).toContain(`— ${label}`)
    }
  })

  it('tells 7.4 to fill Proof from the implement phase, one line per criterion', () => {
    const skill = read(path.join(skillDir, 'SKILL.md'))
    const step = skill.slice(skill.indexOf('### 7.4'), skill.indexOf('### 7.5'))
    expect(step).toContain('`### Proof`')
    expect(step).toContain('one line per acceptance criterion')
    expect(step).toContain('`Driven:` lines')
  })
})

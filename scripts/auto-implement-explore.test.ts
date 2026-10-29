/**
 * /auto-implement explores the codebase through one read-only subagent (HON-1239).
 *
 * Every tool result in a worker's main context is paid again on every later
 * request. On 2026-10-20 file reads were a median of about 32,600 tokens per run,
 * and 1 of 17 runs delegated a read. So Phase 2 hands its reads (2.4 project
 * context, 2.6 codebase exploration) to one `Explore` call and plans from the
 * brief it returns. These tests keep the steps from drifting back to direct
 * reads, and keep the prompt asking for what the plan needs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillDir = path.join(repoRoot, '.claude/skills/auto-implement')
const read = (file: string) => fs.readFileSync(path.join(skillDir, file), 'utf8')

/** The text from one `###`/`##` heading up to the next heading named `end`. */
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start)
  const to = text.indexOf(end, from + start.length)
  expect(from, `heading "${start}" not found`).toBeGreaterThanOrEqual(0)
  expect(to, `heading "${end}" not found after "${start}"`).toBeGreaterThan(from)
  return text.slice(from, to)
}

describe('auto-implement Phase 2 exploration', () => {
  const skill = read('SKILL.md')
  const explore = section(skill, '### 2.6 Explore codebase', '### 2.7 Write plan')
  const beforePlan = section(skill, '### 2.4 Read project context', '### 2.7 Write plan')

  it('makes exactly one Explore call, on Sonnet, in the foreground', () => {
    const calls = explore.match(/Agent\(\{[^\n]*\}\)/g) ?? []
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('subagent_type: "Explore"')
    expect(calls[0]).toContain('model: "sonnet"')
    expect(calls[0]).toContain('run_in_background: false')
  })

  it('states the rule with its reason', () => {
    expect(explore).toContain(
      'From 2.4 until the plan posts, read no file outside `.claude/skills/`',
    )
    expect(explore).toContain('a file read in the main context is paid on every later request')
  })

  it('hands docs/PROJECT_SPEC.md to the Explore call instead of reading it in 2.4', () => {
    const projectContext = section(skill, '### 2.4 Read project context', '### 2.5')
    expect(projectContext).toContain('the 2.6 Explore call reads `docs/PROJECT_SPEC.md`')
    expect(read('templates.md')).toContain('`docs/PROJECT_SPEC.md`')
  })

  it('reads no source file directly between 2.4 and the plan', () => {
    // The sibling diff and the 7b greps moved into the Explore prompt too.
    for (const direct of [/^\s*Read /m, /\bcat\s/, /\bsed -n\b/, /\bgit diff\b/, /\bgit log\b/]) {
      expect(beforePlan).not.toMatch(direct)
    }
  })
})

describe('auto-implement Explore prompt (templates.md)', () => {
  const prompt = section(read('templates.md'), '## Explore prompt (2.6)', '## Plan (2.7)')

  it('passes the issue files, functions and acceptance criteria', () => {
    expect(prompt).toContain('Files and functions it names:')
    expect(prompt).toContain('Acceptance criteria:')
  })

  it('asks for the four parts of the brief the plan needs', () => {
    expect(prompt).toContain('**Files to change**: each with `path:line` anchors')
    expect(prompt).toContain('**Pattern to copy**: one existing reference file')
    expect(prompt).toContain('**Tests and stories**')
    expect(prompt).toContain('**Sibling changes**')
  })

  it('keeps the sibling diff and the coupled-callsite scan the old 2.6 ran', () => {
    expect(prompt).toContain('git log --oneline --since="14 days ago" -- <paths>')
    // The diff is the sibling's merge commit, not origin/main~<PR number> (review of PR #1314).
    expect(prompt).toContain('gh pr view <PR> --json mergeCommit --jq .mergeCommit.oid')
    expect(prompt).toContain('git diff <sha>~1..<sha> -- <paths>')
    expect(prompt).not.toContain('origin/main~<N>')
    expect(prompt).toContain('step 7b')
    expect(prompt).toContain('Mirror, Override or Deliberate')
  })

  it('lets the subagent apply the 7b trigger, because it is the first to see the file set', () => {
    expect(prompt).toContain('Item 5 always goes in')
    expect(prompt).toContain('Otherwise write `not applicable`')
  })

  it('checks recent main commits to the issue files from PRs no sibling links (HON-1282)', () => {
    expect(prompt).toContain('7. **Unlinked recent changes**: for each file the issue names')
    expect(prompt).toContain('git log --oneline --since="14 days ago" origin/main -- <path>')
    expect(prompt).toContain(
      "compare its diff (`git show <sha> -- <path>`) with the issue's stated placement",
    )
    // The unlinked case has no sibling, so the item cannot depend on 2.3 finding one.
    expect(prompt).toContain('Item 7 always goes in too')
  })

  it('puts the unlinked-change mismatches in the plan Context', () => {
    const plan = section(read('templates.md'), '## Plan (2.7)', '## Design Decisions')
    expect(plan).toContain("Name each mismatch from the brief's item 7")
  })
})

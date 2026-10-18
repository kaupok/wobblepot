/**
 * The browser rule that the review skills point to (HON-1242).
 *
 * docs/CHROME_TESTING.md → Which browser states once which browser an agent uses:
 * the T3 Code sidebar first, then the Chrome extension, then the Playwright MCP.
 * Three skills point to it instead of carrying a copy. All of it is prose, so an
 * unrelated edit can drop the rule or a pointer and nothing fails. Before this
 * rule, an agent in T3 Code searched for Chrome tools, then loaded the Playwright
 * MCP, and had to be told to use the sidebar the user was watching.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

const doc = read('docs/CHROME_TESTING.md')

/** The body of one `## ` section, up to the next `## ` heading. */
function section(source: string, heading: string): string {
  const start = source.indexOf(`\n## ${heading}\n`)
  expect(start, `section "${heading}"`).toBeGreaterThan(-1)
  const rest = source.slice(start + heading.length + 5)
  const end = rest.search(/^## /m)
  return end === -1 ? rest : rest.slice(0, end)
}

const T3 = 'mcp__t3-code__preview_'
const CHROME = 'mcp__claude-in-chrome__'
const PLAYWRIGHT = 'mcp__playwright__browser_'

describe('docs/CHROME_TESTING.md', () => {
  it('is titled for all three browsers', () => {
    expect(doc.split('\n')[0]).toBe('# Browser review')
  })

  it('orders the browsers T3 Code sidebar, Chrome extension, Playwright MCP', () => {
    const rule = section(doc, 'Which browser')
    const steps = rule.split('\n').filter((line) => /^\d\. /.test(line))
    expect(steps).toHaveLength(4)
    expect(steps[0]).toContain(T3)
    expect(steps[1]).toContain(CHROME)
    expect(steps[2]).toContain(PLAYWRIGHT)
    expect(steps[3]).toMatch(/^4\. Else say so and continue without browsing/)
  })

  it('says how to open, navigate, snapshot and save a screenshot in the sidebar', () => {
    const sidebar = section(doc, 'T3 Code sidebar browser')
    expect(sidebar).toContain('`preview_open`')
    expect(sidebar).toContain("`preview_navigate` with `{kind: 'environment-port', port: 3200}`")
    expect(sidebar).toContain('`preview_snapshot`')
    expect(sidebar).toContain('`preview_snapshot` with `save: true`')
    expect(sidebar).toContain('`screenshotPath`')
  })

  // Linear and some renderers drop an indented table's cells (CLAUDE.md → Writing
  // for Agents), so every row starts at column 0.
  it('keeps the tool mapping as a top-level table', () => {
    const rows = section(doc, 'Tool mapping')
      .split('\n')
      .filter((line) => line.trimStart().startsWith('|'))
    expect(rows.length).toBeGreaterThanOrEqual(10)
    for (const row of rows) expect(row.startsWith('|')).toBe(true)
    expect(rows[0]).toMatch(/\| Action +\| T3 Code sidebar +\| Playwright MCP +\|/)
    expect(rows).toContainEqual(expect.stringMatching(/`preview_click` +\| `browser_click`/))
    expect(rows).toContainEqual(expect.stringMatching(/`t3_preview_close` +\| `browser_close`/))
  })

  it('files the Chrome setup under the Chrome extension heading', () => {
    const chrome = section(doc, 'Chrome extension')
    expect(chrome).toContain('### Prerequisites')
    expect(chrome).toContain('### Enable for a session')
    expect(chrome).toContain('claude --chrome')
  })
})

describe('the skills point to the rule', () => {
  it.each([
    '.claude/skills/ideate/SKILL.md',
    '.claude/skills/chrome-review/SKILL.md',
    '.claude/skills/implement-issue/SKILL.md',
  ])('%s names the T3 Code sidebar first and points to Which browser', (rel) => {
    const skill = read(rel)
    expect(skill).toContain('`docs/CHROME_TESTING.md` → Which browser')
    const t3 = skill.indexOf('T3 Code sidebar')
    expect(t3).toBeGreaterThan(-1)
    const chrome = skill.indexOf('Chrome extension')
    if (chrome !== -1) expect(t3).toBeLessThan(chrome)
  })

  // The acceptance criterion: /chrome-review runs with only the sidebar browser.
  it('/chrome-review stops only when none of the three browsers is listed', () => {
    const step1 = read('.claude/skills/chrome-review/SKILL.md').split('### Step 2')[0]
    expect(step1).toContain(T3)
    expect(step1).toContain(CHROME)
    expect(step1).toContain(PLAYWRIGHT)
    expect(step1).toContain('If none of the three is listed, stop')
  })

  it('no skill or doc offers `claude --chrome` as the only way to browse', () => {
    const files = [
      'CLAUDE.md',
      'docs/CHROME_TESTING.md',
      ...fs
        .readdirSync(path.join(repoRoot, '.claude/skills'))
        .map((name) => `.claude/skills/${name}/SKILL.md`)
        .filter((rel) => fs.existsSync(path.join(repoRoot, rel))),
    ]
    for (const rel of files) {
      const source = read(rel)
      if (source.includes('claude --chrome')) expect(source, rel).toContain('T3 Code')
    }
  })

  it('/ideate no longer starts from the Chrome-only tabs_context_mcp', () => {
    const skill = read('.claude/skills/ideate/SKILL.md')
    expect(skill).not.toContain('tabs_context_mcp')
    expect(skill).toContain('`preview_status`')
  })
})

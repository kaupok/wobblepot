/**
 * The local mode of scripts/pr-review.sh (HON-1404): `--local <ISSUE_ID>` reviews the
 * branch's changes before a PR exists, with the PR reviewer's own prompt.
 *
 * Both modes run here for real, in a scratch repository with `claude` and `gh`
 * stubbed on PATH. The `claude` stub saves the prompt it was given, so the test
 * compares the two prompts the script builds rather than its source text: a block
 * copied into one mode and edited there fails the comparison, whatever it is named.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))

// Far above any real issue or PR number, so a run never touches a live review's
// findings file or lock.
const ISSUE_ID = 'HON-999917'
const PR_NUMBER = '999917'
const OUT_FILE = `/tmp/auto-implement-local-review-${ISSUE_ID}.md`
const SUMMARY = '<!-- claude-review -->\n### Claude review\n\nNo issues found.\n'

// A component, its test and an untracked new module: the design, E2E, test and
// driven-screen gates all fire on this list in PR mode.
const CHANGED = [
  'src/components/Widget.test.tsx',
  'src/components/Widget.tsx',
  'src/lib/new-thing.ts',
]

let repo: string
let stubBin: string
let promptDump: string
let ghLog: string

function git(...args: string[]) {
  execFileSync('git', args, {
    cwd: repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
    stdio: 'ignore',
  })
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), text)
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hon1404-repo-'))
  stubBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hon1404-bin-'))
  promptDump = path.join(stubBin, 'prompt')
  ghLog = path.join(stubBin, 'gh-calls')

  for (const file of ['pr-review.sh', 'pr-review-base.sh', 'models.sh']) {
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    fs.copyFileSync(path.join(scriptsDir, file), path.join(repo, 'scripts', file))
  }
  write(
    '.mcp.json',
    JSON.stringify({ mcpServers: { 'linear-server': { type: 'http', url: 'x' } } }),
  )
  write('src/components/Widget.tsx', 'export const Widget = 1\n')

  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('checkout', '-q', '-b', 'feature')
  write('src/components/Widget.tsx', 'export const Widget = 2\n')
  write('src/components/Widget.test.tsx', 'it("x", () => {})\n')
  git('add', '.')
  git('commit', '-q', '-m', 'change')
  // main moves on after the branch point, so its tip and the merge base differ, and a
  // file changed only on main must stay out of the review.
  git('checkout', '-q', 'main')
  write('README.md', 'main moved on\n')
  git('add', '.')
  git('commit', '-q', '-m', 'main moves on')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('checkout', '-q', 'feature')
  // Uncommitted work is reviewed too: 4.3 runs before Phase 5 commits.
  write('src/lib/new-thing.ts', 'export const n = 1\n')

  // `claude`: save the prompt (the argument after `--`), print a summary.
  fs.writeFileSync(
    path.join(stubBin, 'claude'),
    [
      '#!/bin/sh',
      'for a; do last="$a"; done',
      `printf '%s' "$last" > ${JSON.stringify(promptDump)}`,
      `printf '%s' "$STUB_SUMMARY"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  // `gh`: log every call, and answer the PR-mode reads for the same change.
  fs.writeFileSync(
    path.join(stubBin, 'gh'),
    [
      '#!/bin/sh',
      `echo "$*" >> ${JSON.stringify(ghLog)}`,
      'case "$*" in',
      `  *"--json files"*) printf '%s\\n' ${CHANGED.map((f) => JSON.stringify(f)).join(' ')} ;;`,
      `  *"--json changedFiles"*) echo ${CHANGED.length} ;;`,
      `  *"--json body"*) echo "Closes ${ISSUE_ID}" ;;`,
      `  *"--json headRefName"*) echo "kaupo/${ISSUE_ID.toLowerCase()}-widget" ;;`,
      "  api*) echo '[]' ;;",
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
})

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(stubBin, { recursive: true, force: true })
  fs.rmSync(OUT_FILE, { force: true })
})

/** Run the copied script; return its exit code, the prompt it sent and the gh calls. */
function run(args: string[], summary = SUMMARY) {
  fs.rmSync(promptDump, { force: true })
  fs.rmSync(ghLog, { force: true })
  let status = 0
  try {
    execFileSync('bash', [path.join(repo, 'scripts/pr-review.sh'), ...args], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, STUB_SUMMARY: summary },
    })
  } catch (err) {
    status = (err as { status: number }).status
  }
  const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
  return { status, prompt: read(promptDump), ghCalls: read(ghLog) }
}

/** The prompt cut into its `## ` sections, keyed by heading. */
function sections(prompt: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of prompt.split(/\n(?=## )/).slice(1)) {
    const heading = part.slice(0, part.indexOf('\n'))
    map.set(heading, part)
  }
  return map
}

/** The `### ` subsection of the step-by-step section that starts with `heading`. */
function step(prompt: string, heading: string): string {
  const start = prompt.indexOf(`### ${heading}`)
  if (start === -1) throw new Error(`no step "${heading}"`)
  const end = prompt.indexOf('\n### ', start + 1)
  return prompt.slice(start, end === -1 ? undefined : end)
}

/** The fenced summary format both modes ask for. */
function summaryFormat(prompt: string): string {
  const start = prompt.indexOf('\\`\\`\\`markdown\n<!-- claude-review -->')
  if (start === -1) throw new Error('no summary format')
  return prompt.slice(start, prompt.indexOf('\\`\\`\\`\n', start + 1))
}

describe('pr-review.sh --local', () => {
  let local: ReturnType<typeof run>
  let pr: ReturnType<typeof run>

  beforeAll(() => {
    local = run(['--local', ISSUE_ID.toLowerCase()])
    pr = run([PR_NUMBER])
  })

  it('writes the summary to the findings file and calls gh not once', () => {
    expect(local.status).toBe(0)
    expect(fs.readFileSync(OUT_FILE, 'utf8')).toBe(SUMMARY)
    expect(local.ghCalls).toBe('')
  })

  it('still reads and posts through gh in PR mode', () => {
    expect(pr.status).toBe(0)
    expect(pr.ghCalls).toContain(`pr view ${PR_NUMBER} --json files`)
    expect(pr.prompt).toContain(`gh pr diff ${PR_NUMBER}`)
    expect(pr.prompt).toContain(`/repos/{owner}/{repo}/issues/${PR_NUMBER}/comments --method POST`)
  })

  it('reviews committed, uncommitted and untracked changes against the merge base', () => {
    const rev = (ref: string) =>
      execFileSync('git', ['rev-parse', ref], { cwd: repo, encoding: 'utf8' }).trim()
    // The branch point is the commit before main moved on, not main's tip.
    expect(local.prompt).toContain(`git diff ${rev('main~1')}\n`)
    expect(local.prompt).not.toContain(rev('origin/main'))
    expect(local.prompt).toContain('git ls-files --others --exclude-standard')
    expect(local.prompt).not.toMatch(/\bgh (pr|api) /)
  })

  it('substitutes every placeholder in both modes', () => {
    expect(local.prompt).not.toMatch(/__[A-Z_]+__/)
    expect(pr.prompt).not.toMatch(/__[A-Z_]+__/)
  })

  it('checks the diff against the issue named on the command line', () => {
    expect(local.prompt).toContain(`## Also check the diff against the issue (Spec)`)
    expect(local.prompt).toContain(`**Spec:** checked against ${ISSUE_ID}`)
  })

  it('leaves out only the PR-body and driven-screen checks', () => {
    const prHeadings = [...sections(pr.prompt).keys()]
    const localHeadings = [...sections(local.prompt).keys()]
    expect(prHeadings).toContain("## Also check the PR body's Verified / Not verified lists")
    expect(prHeadings).toContain('## Also check that the changed screens were driven')
    expect(localHeadings).toEqual(
      prHeadings.filter(
        (h) =>
          h !== "## Also check the PR body's Verified / Not verified lists" &&
          h !== '## Also check that the changed screens were driven',
      ),
    )
  })

  // Only the task list, the step section (steps 1, 4 and 5) and the rules differ
  // by mode. Every other section, steps 2-3 and the summary format are one text.
  it('sends the same text as PR mode for every shared section', () => {
    const modeSpecific = ['## Your task', '## Step-by-step execution', '## Rules']
    const prSections = sections(pr.prompt)
    const shared = [...sections(local.prompt)].filter(([h]) => !modeSpecific.includes(h))
    expect(shared.length).toBeGreaterThan(5)
    for (const [heading, text] of shared) expect(text, heading).toBe(prSections.get(heading))

    for (const name of ['Step 2: Read changed files in full', 'Step 3: Explore related code']) {
      expect(step(local.prompt, name), name).toBe(step(pr.prompt, name))
    }
    expect(summaryFormat(local.prompt)).toBe(summaryFormat(pr.prompt))
  })

  it('writes no findings file when the reviewer prints no summary', () => {
    const { status } = run(['--local', ISSUE_ID], 'I could not finish the review.')
    expect(status).toBe(1)
    expect(fs.existsSync(OUT_FILE)).toBe(false)
  })

  it('rejects an issue ID the Spec gate cannot read', () => {
    expect(run(['--local', 'ENG-12']).status).toBe(1)
    expect(run(['--local']).status).toBe(1)
  })
})

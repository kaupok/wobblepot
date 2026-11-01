/**
 * The steering eval (HON-1345, docs/STEERING_EVAL.md). The scripts run here for
 * real against this checkout, with `claude` stubbed on PATH: the stub records
 * its argv and writes a file whose shape depends on whether the steering file
 * still holds the rule, so the arms, the checks and the verdict all show in the
 * table the script prints.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.dirname(scriptsDir)
const rulesDir = path.join(scriptsDir, 'steering-eval')

interface Rule {
  id: string
  remove: { file: string; text: string }[]
  prompt: string
  check: string
}

const RULES: Rule[] = fs
  .readdirSync(rulesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(rulesDir, f), 'utf8')) as Rule)

const GROUP_1 = [
  'auth-client-sign-in',
  'guard-unlikely',
  'inline-single-use',
  'server-components-default',
  'typography-components',
  'validate-once',
]

let tmp: string
let stubBin: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'steering-eval-'))
  stubBin = path.join(tmp, 'bin')
  fs.mkdirSync(stubBin)
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** Run a snippet with the lib sourced, as the entry script does. */
function lib(snippet: string, env: Record<string, string> = {}) {
  return spawnSync(
    'bash',
    [
      '-c',
      `REPO_ROOT="$1"; source "$2/models.sh"; source "$2/steering-eval-lib.sh"; ${snippet}`,
      'bash',
      repoRoot,
      scriptsDir,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, ...env },
    },
  )
}

function writeStub(body: string) {
  fs.writeFileSync(path.join(stubBin, 'claude'), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
}

describe('rule definitions', () => {
  it('defines every group 1 rule', () => {
    expect(RULES.map((r) => r.id).sort()).toEqual(GROUP_1)
  })

  it.each(RULES)('$id: the rule text is at HEAD in its file', (rule) => {
    for (const { file, text } of rule.remove)
      expect(fs.readFileSync(path.join(repoRoot, file), 'utf8')).toContain(text)
  })

  it.each(RULES)('$id: the prompt names only the task', (rule) => {
    expect(rule.prompt).not.toMatch(/\b(test(ed|ing)?|eval\w*|rule|steering|CLAUDE\.md)\b/i)
  })

  it.each(RULES)('$id: the check passes a known-good diff and fails a known-bad one', (rule) => {
    const fixture = (kind: string) => path.join(rulesDir, 'fixtures', `${rule.id}.${kind}.patch`)
    const run = (kind: string) =>
      execFileSync('bash', ['-c', `${rule.check} "$@"`, 'check', tmp, '/dev/null', fixture(kind)], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    expect(run('good')).toBe('PASS')
    const bad = fs
      .readdirSync(path.join(rulesDir, 'fixtures'))
      .filter((f) => f.startsWith(`${rule.id}.bad`))
      .map((f) => f.slice(rule.id.length + 1, -'.patch'.length))
    expect(bad).toContain('bad')
    for (const kind of bad) expect([kind, run(kind)]).toEqual([kind, 'FAIL'])
  })
})

describe('se_prepare_tree', () => {
  const rule = RULES.find((r) => r.id === 'guard-unlikely')!
  const ruleFile = path.join(rulesDir, 'guard-unlikely.json')

  it.each(['control', 'treatment'])(
    '%s: a one-commit worktree with no eval files',
    (arm) => {
      const dest = path.join(tmp, `prepare-${arm}`)
      const result = lib(`se_prepare_tree "${ruleFile}" ${arm} "${dest}"`)
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const wt = path.join(dest, 'wt')
      for (const { file, text } of rule.remove) {
        const body = fs.readFileSync(path.join(wt, file), 'utf8')
        expect(body.includes(text)).toBe(arm === 'treatment')
      }
      expect(fs.existsSync(path.join(wt, 'scripts/steering-eval'))).toBe(false)
      expect(fs.existsSync(path.join(wt, 'docs/STEERING_EVAL.md'))).toBe(false)
      expect(fs.existsSync(path.join(wt, 'scripts/steering-eval.sh'))).toBe(false)
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', wt, ...args], { encoding: 'utf8' }).trim()
      expect(git('rev-list', '--count', 'HEAD')).toBe('1')
      expect(git('remote')).toBe('')
      expect(git('status', '--porcelain')).toBe('')
      // A worktree: git-dir differs from common-dir, so the main-checkout hook allows edits.
      expect(git('rev-parse', '--git-dir')).not.toBe(git('rev-parse', '--git-common-dir'))
    },
    60_000,
  )

  // The control tree is the agent's whole view, so no file in it may hold a copy
  // of the rule: a doc that quotes it would give the rule back.
  it.each(RULES)(
    '$id: the control tree holds no copy of the rule',
    (rule) => {
      const dest = path.join(tmp, `control-${rule.id}`)
      const ruleFile = path.join(rulesDir, `${rule.id}.json`)
      const result = lib(`se_prepare_tree "${ruleFile}" control "${dest}"`)
      expect(result.status).toBe(0)
      for (const { text } of rule.remove) {
        const needle = (text.split('\n')[0] ?? '').slice(0, 40)
        const grep = spawnSync(
          'grep',
          ['-rlF', '--exclude-dir=node_modules', '--exclude-dir=.git', '-e', needle, '.'],
          { cwd: path.join(dest, 'wt'), encoding: 'utf8' },
        )
        expect(grep.stdout).toBe('')
      }
      fs.rmSync(dest, { recursive: true, force: true })
    },
    60_000,
  )

  it('strips the doc sections that name the eval', () => {
    const wt = path.join(tmp, 'prepare-control', 'wt')
    expect(fs.readFileSync(path.join(wt, 'docs/AGENT_HISTORY.md'), 'utf8')).not.toContain(
      'steering eval',
    )
    expect(fs.readFileSync(path.join(wt, 'docs/PARALLEL_WORKFLOW.md'), 'utf8')).not.toContain(
      'steering eval',
    )
    // Only the section goes: the heading after it stays.
    expect(fs.readFileSync(path.join(wt, 'docs/AGENT_HISTORY.md'), 'utf8')).toContain(
      '## Steering file size',
    )
  })

  it('fails when the rule text is no longer in its file', () => {
    const stale = path.join(tmp, 'stale.json')
    fs.writeFileSync(
      stale,
      JSON.stringify({ ...rule, remove: [{ file: 'CLAUDE.md', text: 'no such rule text' }] }),
    )
    const result = lib(`se_prepare_tree "${stale}" control "${path.join(tmp, 'stale')}"`)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('rule text not found in')
  }, 60_000)
})

describe('se_launch', () => {
  it('runs claude -p with no MCP server, stream-json and the given model and effort', () => {
    const argvFile = path.join(tmp, 'argv')
    writeStub(
      `printf '%s\\n' "$@" > "${argvFile}"; echo "\${ANTHROPIC_API_KEY:-unset}" >> "${argvFile}"`,
    )
    const result = lib(`se_launch "${tmp}" model-x high "do the task" "${tmp}/s.jsonl"`, {
      ANTHROPIC_API_KEY: 'sk-test',
    })
    expect(result.status).toBe(0)
    expect(fs.readFileSync(argvFile, 'utf8').trim().split('\n')).toEqual([
      '-p',
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'model-x',
      '--effort',
      'high',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--',
      'do the task',
      'unset',
    ])
  })

  it('reports a run past its bound as a timeout', () => {
    writeStub('sleep 5')
    const result = lib(`se_launch "${tmp}" m "" p "${tmp}/s.jsonl"`, {
      STEERING_EVAL_TIMEOUT: '1',
    })
    expect([124, 142]).toContain(result.status)
  }, 20_000)
})

describe('se_verdict', () => {
  it.each([
    ['3 0 0', 'dead: control passes'],
    ['2 0 1', 'error'],
    ['0 0 3', 'error'],
    ['1 2 0 3 0 0', 'live'],
    ['0 3 0 1 2 0', 'live'],
    ['0 3 0 0 3 0', 'dead: both arms fail'],
    ['1 2 0 1 2 0', 'dead: both arms fail'],
    ['0 3 0 0 0 3', 'error'],
  ])('%s → %s', (counts, verdict) => {
    expect(lib(`se_verdict ${counts}`).stdout.trim()).toBe(verdict)
  })

  it('prints the odds sentence for N', () => {
    expect(lib('se_odds_sentence 3').stdout.trim()).toBe(
      'With N=3 per model, a rule the model breaks one run in ten passes all 9 control runs 39% of the time. So `dead` means "not broken often", not "never needed".',
    )
  })
})

describe('steering-eval.sh', () => {
  const ruleFile = path.join(rulesDir, 'server-components-default.json')

  function runEval(env: Record<string, string> = {}, args: string[] = []) {
    const script = path.join(scriptsDir, 'steering-eval.sh')
    return spawnSync('bash', [script, ruleFile, '--n', '1', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH}`,
        STEERING_EVAL_OUT: path.join(tmp, 'out'),
        CLAUDE_AUTO_MODEL: 'auto-x',
        CLAUDE_AUTO_EFFORT: '',
        CLAUDE_AUTO_MODEL_SMALL: 'small-x',
        CLAUDE_AUTO_EFFORT_SMALL: 'low',
        CLAUDE_INTERACTIVE_MODEL: 'interactive-x',
        ...env,
      },
    })
  }

  it('is executable, as the docs run it', () => {
    expect(fs.statSync(path.join(scriptsDir, 'steering-eval.sh')).mode & 0o111).not.toBe(0)
  })

  it('runs control, then treatment when control fails, and prints the table', () => {
    // Without the rule the stub writes a client component with no hook; with it,
    // a server component. So control fails, treatment passes: live on every model.
    writeStub(`
mkdir -p src/components
if grep -q 'Server Components by default' CLAUDE.md; then
  printf 'export function Card() { return null }\\n' > src/components/Card.tsx
else
  printf "'use client'\\nexport function Card() { return null }\\n" > src/components/Card.tsx
fi
echo '{"type":"result"}'`)
    const result = runEval()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      [
        '| Rule | Model | Control pass | Treatment pass | Verdict |',
        '| -- | -- | -- | -- | -- |',
        '| server-components-default | auto-x | 0/1 | 1/1 | live |',
        '| server-components-default | small-x (low) | 0/1 | 1/1 | live |',
        '| server-components-default | interactive-x | 0/1 | 1/1 | live |',
        '',
        'With N=1 per model, a rule the model breaks one run in ten passes all 3 control runs 73% of the time. So `dead` means "not broken often", not "never needed".',
        '',
      ].join('\n'),
    )
  }, 180_000)

  it('stops on a --model that matches no model', () => {
    const result = runEval({}, ['--model', 'no-such-model'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No model matches --model no-such-model')
  })

  it('counts a run that printed its result as finished, even when the process outlives the bound', () => {
    writeStub(`
mkdir -p src/components
printf 'export function Card() { return null }\\n' > src/components/Card.tsx
echo '{"type":"result","is_error":false}'
sleep 5`)
    const result = runEval({ STEERING_EVAL_TIMEOUT: '1' }, ['--model', 'auto-x'])
    expect(result.status).toBe(0)
    expect(result.stdout.split('\n').filter((l) => l.startsWith('| server'))).toEqual([
      '| server-components-default | auto-x | 1/1 | not run | dead: control passes |',
    ])
  }, 180_000)

  it.each([
    ['a timeout', 'echo x > new-file.ts; sleep 5'],
    ['a run with no diff', 'echo done'],
    ['a non-zero exit', 'echo x > new-file.ts; exit 1'],
  ])(
    'counts %s as an error, not a pass',
    (_name, stub) => {
      writeStub(stub)
      const result = runEval({ STEERING_EVAL_TIMEOUT: '2' }, ['--model', 'auto-x'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        '| server-components-default | auto-x | 0/1 (1 error) | not run | error |',
      )
    },
    180_000,
  )
})

describe('steering-eval.sh edited mid-run', () => {
  // Bash reads a script as it runs it. A group run lasts hours, and an edit to the
  // script in that time once made bash resume at a shifted offset and launch
  // treatment runs that no control failure called for (HON-1345).
  it('finishes the run it started', async () => {
    const repo = path.join(tmp, 'edit-repo')
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
    for (const file of ['steering-eval.sh', 'steering-eval-lib.sh', 'models.sh'])
      fs.copyFileSync(path.join(scriptsDir, file), path.join(repo, 'scripts', file))
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'Guidance\n')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    execFileSync('git', ['add', '-A'], { cwd: repo })
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base'],
      { cwd: repo },
    )
    const rule = path.join(tmp, 'edit-rule.json')
    fs.writeFileSync(
      rule,
      JSON.stringify({ id: 'edit', remove: [], prompt: 'p', check: 'echo PASS' }),
    )
    writeStub(`echo x > new-file.txt; sleep 2; echo '{"type":"result","is_error":false}'`)

    const script = path.join(repo, 'scripts', 'steering-eval.sh')
    const child = spawn('bash', [script, rule, '--n', '1'], {
      env: {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH}`,
        STEERING_EVAL_OUT: path.join(tmp, 'edit-out'),
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    await new Promise((resolve) => setTimeout(resolve, 1000))
    fs.writeFileSync(script, `# ${'x'.repeat(400)}\n${fs.readFileSync(script, 'utf8')}`)
    const status = await new Promise((resolve) => child.on('close', resolve))

    expect(stderr).not.toContain('syntax error')
    expect(status).toBe(0)
    expect(stdout.split('\n').filter((l) => l.startsWith('| edit '))).toHaveLength(3)
    expect(fs.readdirSync(path.join(tmp, 'edit-out')).length).toBe(1)
  }, 120_000)
})

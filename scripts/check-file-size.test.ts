import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allowedTokens,
  allowlistGrowth,
  evaluate,
  isScanned,
  lowerCaps,
  parseAllowlist,
  splitAdvice,
  tokensOf,
} from './check-file-size'

/**
 * The gate is green on `main` by design, so these tests exist to prove it
 * fires: on a new large file, on a listed file past its headroom, and on the
 * staged content rather than the working copy.
 */

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptsDir, '..')
const script = path.join(scriptsDir, 'check-file-size.ts')
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx')

/** Run the script exactly as `pnpm file-size:check` does. */
function run(...args: string[]): { status: number; output: string } {
  const result = spawnSync(tsx, [script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repoRoot,
  })
  // A missing tsx binary or a timeout leaves `status` null, which would satisfy
  // an "exits non-zero" assertion for the wrong reason. Fail on it here.
  expect(result.error, `could not spawn ${tsx}`).toBeUndefined()
  expect(result.status, 'process did not exit normally').not.toBeNull()
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('isScanned', () => {
  it.each([
    ['src/components/meal-plan/MealCard.tsx', true],
    ['src/lib/auth.ts', true],
    ['scripts/orchestrator.sh', true],
    ['src/app/globals.css', true],
    ['eslint.config.mjs', true],
    ['messages/en.json', false],
    ['docs/DESIGN.md', false],
    ['pnpm-lock.yaml', false],
    ['prisma/migrations/20260101_init/migration.sql', false],
    ['prisma/seed.ts', false],
    ['prisma/seed-expansion.ts', false],
    ['src/generated/prisma/client.ts', false],
    ['public/mockServiceWorker.js', false],
  ])('%s → %s', (file, expected) => {
    expect(isScanned(file)).toBe(expected)
  })
})

describe('tokensOf and allowedTokens', () => {
  it('counts bytes / 4, rounded up', () => {
    expect(tokensOf(20_000)).toBe(5000)
    expect(tokensOf(20_001)).toBe(5001)
  })

  it('allows the limit for an unlisted file and cap + 5% for a listed one', () => {
    expect(allowedTokens(undefined)).toBe(5000)
    expect(allowedTokens(8000)).toBe(8400)
    expect(allowedTokens(6001)).toBe(6302)
  })
})

describe('parseAllowlist', () => {
  it('reads "<maxTokens> <path>" lines and drops comments and blanks', () => {
    const text = '# header\n\n8000 src/a.ts\n  6000 src/b.ts  # note\n# 7000 src/c.ts\n'
    expect([...parseAllowlist(text)]).toEqual([
      ['src/a.ts', 8000],
      ['src/b.ts', 6000],
    ])
  })

  it('rejects a line without a cap', () => {
    expect(() => parseAllowlist('src/a.ts\n')).toThrow('line 1')
  })
})

describe('evaluate', () => {
  it('fails an unlisted file over the limit and passes one at it', () => {
    const sizes = new Map([
      ['src/big.ts', 5001],
      ['src/edge.ts', 5000],
    ])
    expect(evaluate(sizes, new Map()).failures).toEqual([
      { file: 'src/big.ts', tokens: 5001, allowed: 5000, cap: undefined },
    ])
  })

  it('passes a listed file at its headroom and fails it one token past', () => {
    const caps = new Map([['src/listed.ts', 8000]])
    expect(evaluate(new Map([['src/listed.ts', 8400]]), caps).failures).toEqual([])
    expect(evaluate(new Map([['src/listed.ts', 8401]]), caps).failures).toEqual([
      { file: 'src/listed.ts', tokens: 8401, allowed: 8400, cap: 8000 },
    ])
  })

  it('reports a listed file under its cap as shrunk, and one under the limit as stale', () => {
    const caps = new Map([
      ['src/smaller.ts', 8000],
      ['src/small.ts', 8000],
      ['src/gone.ts', 8000],
    ])
    const sizes = new Map([
      ['src/smaller.ts', 7000],
      ['src/small.ts', 4000],
    ])
    const result = evaluate(sizes, caps)
    expect(result.shrunk).toEqual([{ file: 'src/smaller.ts', tokens: 7000, cap: 8000 }])
    expect(result.stale).toEqual(['src/small.ts', 'src/gone.ts'])
  })

  it('does not call an unmeasured file stale on a partial (staged) scan', () => {
    const caps = new Map([['src/untouched.ts', 8000]])
    expect(evaluate(new Map(), caps, true).stale).toEqual([])
  })
})

describe('lowerCaps', () => {
  it('lowers a cap, drops deleted and small files, and never raises a cap', () => {
    const caps = new Map([
      ['src/smaller.ts', 8000],
      ['src/grew.ts', 6000],
      ['src/small.ts', 8000],
      ['src/gone.ts', 8000],
    ])
    const sizes = new Map([
      ['src/smaller.ts', 7000],
      ['src/grew.ts', 6100],
      ['src/small.ts', 4000],
    ])
    expect([...lowerCaps(caps, sizes)]).toEqual([
      ['src/smaller.ts', 7000],
      ['src/grew.ts', 6000],
    ])
  })
})

describe('allowlistGrowth', () => {
  const base = new Map([
    ['src/a.ts', 8000],
    ['src/b.ts', 6000],
  ])

  it('passes a lowered cap and a dropped entry', () => {
    expect(allowlistGrowth(base, new Map([['src/a.ts', 7000]]), new Map())).toEqual([])
  })

  it('fails a raised cap and a new entry', () => {
    const head = new Map([
      ['src/a.ts', 8001],
      ['src/new.ts', 5500],
    ])
    expect(allowlistGrowth(base, head, new Map())).toEqual([
      'src/a.ts: cap raised from 8000 to 8001',
      'src/new.ts: new entry at cap 5500',
    ])
  })

  it('passes a rename at the same cap and fails one at a higher cap', () => {
    const renames = new Map([['src/moved.ts', 'src/b.ts']])
    expect(allowlistGrowth(base, new Map([['src/moved.ts', 6000]]), renames)).toEqual([])
    expect(allowlistGrowth(base, new Map([['src/moved.ts', 6001]]), renames)).toEqual([
      'src/moved.ts: renamed from src/b.ts, cap raised from 6000 to 6001',
    ])
  })
})

describe('splitAdvice', () => {
  it.each([
    ['src/components/Foo.test.tsx', 'one file per top-level `describe`'],
    ['src/components/Foo.stories.tsx', 'one file per scenario group'],
    ['scripts/orchestrator.sh', 'scripts/lib/<name>.sh'],
    ['src/components/Foo.tsx', 'sub-components'],
    ['src/lib/foo.ts', 'one module per concern'],
  ])('%s → mentions %s', (file, expected) => {
    expect(splitAdvice(file)).toContain(expected)
  })
})

describe('the check on a fixture repo', () => {
  let root: string
  let allowlistPath: string

  function write(relativePath: string, bytes: number): void {
    const file = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'x'.repeat(bytes))
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-size-'))
    allowlistPath = path.join(root, 'allowlist.txt')
    git('init', '-q')
    // Enough small files to clear MIN_PLAUSIBLE_FILES, as a real tree does.
    for (let i = 0; i < 300; i++) write(`src/filler/f${i}.ts`, 10)
    write('src/listed.ts', 32_000)
    write('prisma/seed-big.ts', 100_000)
    write('messages/en.json', 100_000)
    fs.writeFileSync(allowlistPath, '# header\n\n8000 src/listed.ts\n')
    git('add', '.')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('passes a tree where the only large files are listed or out of scope', () => {
    const { status, output } = run(root, allowlistPath)
    expect(status, output).toBe(0)
    expect(output).toContain('301 file(s) scanned')
  })

  it('fails a new tracked file over the limit, with the split advice and the ban', () => {
    write('src/components/Big.tsx', 20_004)
    git('add', '.')
    const { status, output } = run(root, allowlistPath)
    expect(status).toBe(1)
    expect(output).toContain('src/components/Big.tsx: 5001 tokens, limit 5000')
    expect(output).toContain('sub-components')
    expect(output).toContain('Do not delete comments, shorten names or compress code to pass')
  })

  it('fails a listed file past its headroom and names the cap', () => {
    write('src/listed.ts', 33_604)
    const { status, output } = run(root, allowlistPath)
    expect(status).toBe(1)
    expect(output).toContain('src/listed.ts: 8401 tokens, cap 8000 + 5% headroom = 8400')
  })

  it('--update lowers a shrunk cap, after which headroom counts from the new cap', () => {
    write('src/listed.ts', 28_000)
    expect(run(root, allowlistPath).output).toContain('src/listed.ts: 7000 tokens, cap 8000')

    expect(run('--update', root, allowlistPath).status).toBe(0)
    const rewritten = fs.readFileSync(allowlistPath, 'utf8')
    expect(rewritten).toBe('# header\n\n7000 src/listed.ts\n')

    write('src/listed.ts', 29_404) // 7351 tokens: past 7000 + 5% = 7350
    expect(run(root, allowlistPath).status).toBe(1)
  })

  it('--staged judges the index, not the working copy', () => {
    write('src/staged.ts', 20_004)
    git('add', 'src/staged.ts')
    write('src/staged.ts', 10)
    const bigInIndex = run('--staged', root, allowlistPath)
    expect(bigInIndex.status).toBe(1)
    expect(bigInIndex.output).toContain('src/staged.ts: 5001 tokens')

    git('add', 'src/staged.ts')
    write('src/staged.ts', 40_000)
    expect(run('--staged', root, allowlistPath).status).toBe(0)
  })

  it('--staged ignores a staged deletion and an excluded path', () => {
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '-m', 'init')
    git('rm', '-q', 'src/listed.ts')
    write('prisma/seed-big.ts', 200_000)
    git('add', '.')
    const { status, output } = run('--staged', root, allowlistPath)
    expect(status, output).toBe(0)
    expect(output).toContain('0 staged file(s) scanned')
  })

  it('--staged names the allowlist line to move when a listed file is renamed', () => {
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '-m', 'init')
    git('mv', 'src/listed.ts', 'src/renamed.ts')
    const { status, output } = run('--staged', root, allowlistPath)
    expect(status).toBe(1)
    expect(output).toContain('Renamed from src/listed.ts, which is listed at cap 8000')
    expect(output).toContain('"8000 src/renamed.ts"')

    fs.writeFileSync(allowlistPath, '# header\n\n8000 src/renamed.ts\n')
    expect(run('--staged', root, allowlistPath).status).toBe(0)
  })

  it('--base fails a raised cap and passes a moved line for a committed rename', () => {
    const commit = (): void =>
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '-m', 'c')
    commit()
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

    fs.writeFileSync(allowlistPath, '# header\n\n9000 src/listed.ts\n')
    git('add', 'allowlist.txt')
    commit()
    const raised = run('--base', base, root, allowlistPath)
    expect(raised.status).toBe(1)
    expect(raised.output).toContain('src/listed.ts: cap raised from 8000 to 9000')

    git('mv', 'src/listed.ts', 'src/renamed.ts')
    fs.writeFileSync(allowlistPath, '# header\n\n8000 src/renamed.ts\n')
    git('add', 'allowlist.txt')
    commit()
    const moved = run('--base', base, root, allowlistPath)
    expect(moved.status, moved.output).toBe(0)
  })

  it('--base passes when the base has no allowlist yet', () => {
    write('src/other.ts', 10)
    git('rm', '-q', '--cached', 'allowlist.txt')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '-m', 'c')
    const { status, output } = run('--base', 'HEAD', root, allowlistPath)
    expect(status, output).toBe(0)
    expect(output).toContain('does not exist at HEAD')
  })

  it('refuses to pass a tree with too few files', () => {
    fs.rmSync(path.join(root, 'src/filler'), { recursive: true })
    git('add', '-A')
    const { status, output } = run(root, allowlistPath)
    expect(status).toBe(1)
    expect(output).toContain('expected at least 300')
  })
})

describe('the real repository', () => {
  it('passes against the committed allowlist', () => {
    const { status, output } = run()
    expect(status, output).toBe(0)
  })
})

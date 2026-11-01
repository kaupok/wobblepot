// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { main, type MainDeps } from './run'
import { mockModelFactory, starterCasesDir } from './test-utils'

/** Pins the dry-run estimate, so the budget sums come from literals (HON-1572). */
const estimate = vi.hoisted(() => ({ usd: 3 }))
vi.mock('./dry-run', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./dry-run')>()
  return {
    ...mod,
    estimateRun: (args: Parameters<typeof mod.estimateRun>[0]) => ({
      ...mod.estimateRun(args),
      totalCostUsd: estimate.usd,
    }),
    estimateCheck: (args: Parameters<typeof mod.estimateCheck>[0]) => ({
      ...mod.estimateCheck(args),
      totalCostUsd: estimate.usd,
    }),
  }
})

const TIPS_REPLY = {
  object: { equipment: ['a', 'b', 'c'], steps: ['1', '2', '3', '4'], pitfalls: ['a', 'b'] },
}
const CHECK_ARGS = ['--check', '--task', 'tips', '--runs', '1']
const BENCH_ARGS = [
  '--baseline',
  'claude-sonnet-5',
  '--candidate',
  'claude-sonnet-5-5',
  '--task',
  'tips',
  '--runs',
  '1',
]

describe('the monthly eval budget', () => {
  let outDir: string
  let casesDir: string
  let out: string[]
  let err: string[]
  let deps: MainDeps
  const report = (name: string, usd: string) =>
    writeFileSync(join(outDir, name), `# Report\n\n**Total cost:** $${usd} over 30 calls.\n`)

  beforeEach(() => {
    estimate.usd = 3
    outDir = mkdtempSync(join(tmpdir(), 'model-bench-budget-run-'))
    casesDir = starterCasesDir()
    out = []
    err = []
    deps = {
      outDir,
      casesDir,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
      today: () => new Date(2026, 10, 15),
      commit: () => 'abc1234',
      env: {},
    }
    // 38.00 this month; October's report is not counted.
    report('2026-11-01-check-production.md', '12.50')
    report('2026-11-02-check-production.md', '20.25')
    report('2026-11-03-check-tips.md', '5.25')
    report('2026-10-31-check-production.md', '30.00')
  })
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
    rmSync(casesDir, { recursive: true, force: true })
  })

  it.each([
    ['--check', CHECK_ARGS],
    ['a comparison', BENCH_ARGS],
  ])('refuses %s over the budget with exit 1, before any API call', async (_, args) => {
    const { factory, calls } = mockModelFactory(() => TIPS_REPLY)
    const code = await main(args, {
      ...deps,
      env: { AI_EVAL_MONTHLY_USD: '40' },
      modelFactory: factory,
    })

    expect(code).toBe(1)
    expect(calls).toHaveLength(0)
    expect(err.join('\n')).toContain(
      'Monthly eval budget: $38.00 spent this month + $3.00 this run = $41.00, over the $40.00 budget (AI_EVAL_MONTHLY_USD). Not running.',
    )
  })

  it('refuses before the API key check, so no key is needed to be stopped', async () => {
    expect(await main(CHECK_ARGS, deps)).toBe(1)
    expect(err.join('\n')).toContain('over the $40.00 budget')
    expect(err.join('\n')).not.toContain('ANTHROPIC_API_KEY')
  })

  it('runs under a budget of 50, with no budget line', async () => {
    const { factory, calls } = mockModelFactory(() => TIPS_REPLY)
    await main(CHECK_ARGS, { ...deps, env: { AI_EVAL_MONTHLY_USD: '50' }, modelFactory: factory })

    expect(calls.length).toBeGreaterThan(0)
    expect([...out, ...err].join('\n')).not.toContain('Monthly eval budget')
  })

  it('runs over the budget with --allow-over-budget and prints the line', async () => {
    const { factory, calls } = mockModelFactory(() => TIPS_REPLY)
    await main([...CHECK_ARGS, '--allow-over-budget'], { ...deps, modelFactory: factory })

    expect(calls.length).toBeGreaterThan(0)
    expect(err.join('\n')).toContain(
      'Monthly eval budget: $38.00 spent this month + $3.00 this run = $41.00, over the $40.00 budget (AI_EVAL_MONTHLY_USD). Running anyway: --allow-over-budget.',
    )
  })

  it('warns at 75% of the budget and runs', async () => {
    const { factory, calls } = mockModelFactory(() => TIPS_REPLY)
    await main(CHECK_ARGS, { ...deps, env: { AI_EVAL_MONTHLY_USD: '52' }, modelFactory: factory })

    expect(calls.length).toBeGreaterThan(0)
    expect(out).toContain(
      'Warning: monthly eval budget: $38.00 spent this month + $3.00 this run = $41.00, 79% of the $52.00 budget (AI_EVAL_MONTHLY_USD).',
    )
  })

  it.each([
    ['--check', CHECK_ARGS],
    ['a comparison', BENCH_ARGS],
  ])("prints the month's spend and the budget under %s --dry-run, and exits 0", async (_, args) => {
    const code = await main([...args, '--dry-run'], deps)

    expect(code).toBe(0)
    expect(out).toContain(
      'Month so far: $38.00 of the $40.00 budget (AI_EVAL_MONTHLY_USD); this run would bring it to $41.00.',
    )
  })

  it('refuses an AI_EVAL_MONTHLY_USD that is not a positive number', async () => {
    const code = await main([...CHECK_ARGS, '--dry-run'], {
      ...deps,
      env: { AI_EVAL_MONTHLY_USD: 'forty' },
    })
    expect(code).toBe(1)
    expect(err).toContain('AI_EVAL_MONTHLY_USD must be a positive number, got "forty".')
  })
})

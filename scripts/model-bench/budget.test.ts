// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evaluateBudget, monthSpendUsd, parseMonthlyBudget } from './budget'

const NOVEMBER = new Date(2026, 10, 15)

describe('monthSpendUsd', () => {
  let dir: string
  let warnings: string[]
  const report = (name: string, body: string) => writeFileSync(join(dir, name), body)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-bench-budget-'))
    warnings = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("sums the Total cost line of this month's reports and leaves last month's out", () => {
    report('2026-11-01-check-production.md', '# Check\n\n**Total cost:** $12.50 over 30 calls.\n')
    report(
      '2026-11-02-claude-sonnet-5-vs-claude-sonnet-5-5.md',
      '**Total cost:** $20.25 (claude-sonnet-5 $10.00, claude-sonnet-5-5 $10.25 over 84 calls).\n',
    )
    report('2026-11-03-check-tips.md', '**Total cost:** $5.25 over 4 calls — partial run.\n')
    report('2026-10-31-check-production.md', '**Total cost:** $9.00 over 30 calls.\n')

    expect(monthSpendUsd(dir, NOVEMBER, (l) => warnings.push(l))).toBeCloseTo(38, 10)
    expect(warnings).toEqual([])
  })

  it("counts a golden comparison's own spend, not the golden's earlier spend", () => {
    report(
      '2026-11-01-golden-vs-claude-sonnet-5-5.md',
      "**Total cost:** $1.93 (claude-sonnet-5-5 $1.93 over 69 calls). The golden's $1.94 was spent when it was recorded.\n",
    )
    expect(monthSpendUsd(dir, NOVEMBER, () => {})).toBeCloseTo(1.93, 10)
  })

  it('skips a report with no Total cost line and names it in a warning', () => {
    report('2026-11-01-check-production.md', '**Total cost:** $4.00 over 30 calls.\n')
    report('2026-11-02-check-tips.md', '# AI eval check\n\nNo cost here.\n')

    expect(monthSpendUsd(dir, NOVEMBER, (l) => warnings.push(l))).toBe(4)
    expect(warnings).toEqual([
      'Warning: 2026-11-02-check-tips.md has no **Total cost:** line, so the monthly budget does not count it.',
    ])
  })

  it('reads a missing results dir as no spend', () => {
    expect(monthSpendUsd(join(dir, 'absent'), NOVEMBER, () => {})).toBe(0)
  })
})

describe('evaluateBudget', () => {
  it('refuses when the spend plus the estimate passes the budget, naming all three', () => {
    const check = evaluateBudget({
      spentUsd: 38,
      estimateUsd: 3,
      budgetUsd: 40,
      allowOverBudget: false,
    })
    expect(check.verdict).toBe('refuse')
    expect(check.line).toBe(
      'Monthly eval budget: $38.00 spent this month + $3.00 this run = $41.00, over the $40.00 budget (AI_EVAL_MONTHLY_USD). Not running. Pass --allow-over-budget to run anyway.',
    )
  })

  it('runs over the budget with --allow-over-budget, and says so', () => {
    const check = evaluateBudget({
      spentUsd: 38,
      estimateUsd: 3,
      budgetUsd: 40,
      allowOverBudget: true,
    })
    expect(check.verdict).toBe('over-allowed')
    expect(check.line).toContain('$38.00 spent this month + $3.00 this run')
    expect(check.line).toContain('Running anyway: --allow-over-budget.')
  })

  it('warns at 75% of the budget and runs', () => {
    const check = evaluateBudget({
      spentUsd: 27,
      estimateUsd: 3,
      budgetUsd: 40,
      allowOverBudget: false,
    })
    expect(check).toEqual({
      verdict: 'warn',
      line: 'Warning: monthly eval budget: $27.00 spent this month + $3.00 this run = $30.00, 75% of the $40.00 budget (AI_EVAL_MONTHLY_USD).',
    })
  })

  it('stays quiet below 75%, and a sum equal to the budget does not pass it', () => {
    expect(
      evaluateBudget({ spentUsd: 26, estimateUsd: 3, budgetUsd: 40, allowOverBudget: false }),
    ).toEqual({ verdict: 'ok', line: '' })
    expect(
      evaluateBudget({ spentUsd: 37, estimateUsd: 3, budgetUsd: 40, allowOverBudget: false })
        .verdict,
    ).toBe('warn')
  })
})

describe('parseMonthlyBudget', () => {
  it('defaults to 40, reads AI_EVAL_MONTHLY_USD, and refuses a value that is not a positive number', () => {
    expect(parseMonthlyBudget({})).toBe(40)
    expect(parseMonthlyBudget({ AI_EVAL_MONTHLY_USD: '55.5' })).toBe(55.5)
    expect(parseMonthlyBudget({ AI_EVAL_MONTHLY_USD: 'forty' })).toBeNull()
    expect(parseMonthlyBudget({ AI_EVAL_MONTHLY_USD: '0' })).toBeNull()
  })
})

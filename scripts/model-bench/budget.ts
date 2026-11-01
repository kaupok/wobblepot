/**
 * The monthly eval budget (HON-1572): `--max-usd` caps one run, this caps the
 * month. Before a real run, the spend this month is read back from the
 * committed reports in `results/` and this run's estimate is added; a sum over
 * `AI_EVAL_MONTHLY_USD` (default 40) stops the run before any API call, unless
 * `--allow-over-budget` is passed. Apart from `run.ts`, which sits at its
 * file-size cap.
 *
 * Reports in another worktree that have not merged are not counted, so the
 * gate undercounts on a busy day. It still stops a loop of re-runs.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_MONTHLY_USD = 40
export const BUDGET_ENV = 'AI_EVAL_MONTHLY_USD'

/** The share of the budget at which a run prints a warning and goes on. */
const WARN_SHARE = 0.75

/**
 * The run's own total is the first figure; a golden comparison names the
 * golden's earlier spend later in the same line, which is not this month's.
 */
const TOTAL_COST = /^\*\*Total cost:\*\* \$([\d,]+(?:\.\d+)?)/m

/** `AI_EVAL_MONTHLY_USD`, or the default. Null when it is set but not a positive number. */
export function parseMonthlyBudget(env: Record<string, string | undefined>): number | null {
  const raw = env[BUDGET_ENV]
  if (raw === undefined || raw.trim() === '') return DEFAULT_MONTHLY_USD
  const budget = Number(raw)
  return Number.isFinite(budget) && budget > 0 ? budget : null
}

/**
 * The sum of the `**Total cost:**` line of every report in `dir` whose
 * filename date is in the month of `now`. A report with no such line is
 * skipped and named through `warn`.
 */
export function monthSpendUsd(dir: string, now: Date, warn: (line: string) => void): number {
  if (!existsSync(dir)) return 0
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`
  let total = 0
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith(month) || !name.endsWith('.md')) continue
    const figure = TOTAL_COST.exec(readFileSync(join(dir, name), 'utf8'))?.[1]
    if (figure === undefined) {
      warn(`Warning: ${name} has no **Total cost:** line, so the monthly budget does not count it.`)
      continue
    }
    total += Number(figure.replaceAll(',', ''))
  }
  return total
}

export type BudgetVerdict = 'ok' | 'warn' | 'over-allowed' | 'refuse'

export interface BudgetCheck {
  verdict: BudgetVerdict
  /** The line to print; empty when the verdict is `ok`. */
  line: string
}

const usd = (n: number) => `$${n.toFixed(2)}`

export function evaluateBudget(args: {
  spentUsd: number
  estimateUsd: number
  budgetUsd: number
  allowOverBudget: boolean
}): BudgetCheck {
  const { spentUsd, estimateUsd, budgetUsd } = args
  const after = spentUsd + estimateUsd
  const sum = `${usd(spentUsd)} spent this month + ${usd(estimateUsd)} this run = ${usd(after)}`
  if (after > budgetUsd) {
    const over = `Monthly eval budget: ${sum}, over the ${usd(budgetUsd)} budget (${BUDGET_ENV}).`
    return args.allowOverBudget
      ? { verdict: 'over-allowed', line: `${over} Running anyway: --allow-over-budget.` }
      : {
          verdict: 'refuse',
          line: `${over} Not running. Pass --allow-over-budget to run anyway.`,
        }
  }
  if (after >= budgetUsd * WARN_SHARE) {
    const share = Math.round((after / budgetUsd) * 100)
    return {
      verdict: 'warn',
      line: `Warning: monthly eval budget: ${sum}, ${share}% of the ${usd(budgetUsd)} budget (${BUDGET_ENV}).`,
    }
  }
  return { verdict: 'ok', line: '' }
}

/**
 * The gate `run.ts` calls once it has the estimate. Under `--dry-run` it only
 * prints the month's state; otherwise it prints the verdict's line and returns
 * false when the run must not go ahead.
 */
export function budgetGate(
  args: { estimateUsd: number; dryRun: boolean; allowOverBudget: boolean },
  io: {
    dir: string
    now: Date
    env: Record<string, string | undefined>
    log: (line: string) => void
    error: (line: string) => void
  },
): boolean {
  const budgetUsd = parseMonthlyBudget(io.env)
  if (budgetUsd === null) {
    io.error(`${BUDGET_ENV} must be a positive number, got "${io.env[BUDGET_ENV]}".`)
    return false
  }
  const spentUsd = monthSpendUsd(io.dir, io.now, io.error)
  if (args.dryRun) {
    io.log(
      `Month so far: ${usd(spentUsd)} of the ${usd(budgetUsd)} budget (${BUDGET_ENV}); this run would bring it to ${usd(spentUsd + args.estimateUsd)}.`,
    )
    return true
  }
  const { verdict, line } = evaluateBudget({
    spentUsd,
    estimateUsd: args.estimateUsd,
    budgetUsd,
    allowOverBudget: args.allowOverBudget,
  })
  if (verdict === 'refuse' || verdict === 'over-allowed') io.error(line)
  else if (verdict === 'warn') io.log(line)
  return verdict !== 'refuse'
}

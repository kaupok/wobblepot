import { describe, it, expect } from 'vitest'
import * as budgets from './budgets'

/** The `maxDuration` every AI route declares, in milliseconds. */
const MAX_DURATION_MS = 60_000

describe('AI budgets', () => {
  const entries = Object.entries(budgets)

  it('exports every route budget', () => {
    expect(entries.map(([name]) => name).sort()).toEqual([
      'COOK_QUESTION_AI_BUDGET_MS',
      'IMAGINE_AI_BUDGET_MS',
      'PLAN_AI_BUDGET_MS',
      'RECIPE_PARSE_AFTER_URL_FETCH_AI_BUDGET_MS',
      'RECIPE_PARSE_AI_BUDGET_MS',
      'REVIEW_AI_BUDGET_MS',
      'TIPS_AI_BUDGET_MS',
    ])
  })

  it.each(entries)('%s fits under the routes’ 60s maxDuration', (_name, value) => {
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(MAX_DURATION_MS)
  })
})

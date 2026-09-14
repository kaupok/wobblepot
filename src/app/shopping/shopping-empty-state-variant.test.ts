import { describe, it, expect } from 'vitest'
import {
  getShoppingEmptyStateVariant,
  type ShoppingEmptyStateInput,
} from './shopping-empty-state-variant'

function input(overrides: Partial<ShoppingEmptyStateInput> = {}): ShoppingEmptyStateInput {
  return {
    hasAnyPlan: true,
    groupCount: 1,
    totalItems: 3,
    customItemCount: 0,
    ...overrides,
  }
}

describe('getShoppingEmptyStateVariant', () => {
  it('renders the list when there are items to buy', () => {
    expect(getShoppingEmptyStateVariant(input())).toBeUndefined()
  })

  it('shows `no-plan` when the household has no meal plan entries at all', () => {
    expect(
      getShoppingEmptyStateVariant(input({ hasAnyPlan: false, groupCount: 0, totalItems: 0 })),
    ).toBe('no-plan')
  })

  // HON-653: entries only on days 8-14 leave the 7-day window empty, so the API
  // reports `generatedAt: null` — but the household has a plan, and must land on
  // the state that carries the window picker.
  it('shows `nothing-needed` when the plan exists but nothing falls in the window', () => {
    expect(getShoppingEmptyStateVariant(input({ groupCount: 0, totalItems: 0 }))).toBe(
      'nothing-needed',
    )
  })

  it('shows `nothing-needed` when groups exist but every quantity is covered', () => {
    expect(getShoppingEmptyStateVariant(input({ groupCount: 2, totalItems: 0 }))).toBe(
      'nothing-needed',
    )
  })

  it('renders the list for custom items even without a plan', () => {
    expect(
      getShoppingEmptyStateVariant(
        input({ hasAnyPlan: false, groupCount: 0, totalItems: 0, customItemCount: 1 }),
      ),
    ).toBeUndefined()
  })
})

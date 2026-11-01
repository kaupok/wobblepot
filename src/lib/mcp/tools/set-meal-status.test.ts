import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: new Date() }),
}))
vi.mock('./plan-slot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plan-slot')>()),
  findPlanSlot: vi.fn(),
}))
vi.mock('@/lib/meal-plans/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meal-plans/entries')>()),
  updateEntry: vi.fn(),
}))
vi.mock('@/lib/meal-plans/cook-preview', () => ({ previewCookDeduction: vi.fn() }))

import { type PantryCheckRow, previewCookDeduction } from '@/lib/meal-plans/cook-preview'
import { updateEntry } from '@/lib/meal-plans/entries'
import { mcpHousehold } from '@/test/mcp'

import { findPlanSlot } from './plan-slot'
import { setMealStatus } from './set-meal-status'

// The two-call cooked flow for a recipe meal (HON-1565), with the `src/lib`
// functions mocked. `set-meal-status.db.test.ts` runs the same flow against a
// database.

const CALLER = { userId: 'user-1' }
const DATE = '2026-11-02'

const RECIPE_SLOT = {
  id: 'entry-roast',
  planId: 'plan-1',
  kind: 'meal',
  mealId: 'meal-roast',
  mealName: 'Roast',
  status: 'planned',
}
const FRIDGE_SLOT = { ...RECIPE_SLOT, kind: 'fridge', mealId: null, mealName: null }

const BEETROOT: PantryCheckRow = {
  ingredientId: 'beetroot',
  name: 'Beetroot',
  used: 400,
  unit: 'g',
  pantryQuantity: null,
  default: 'usedUp',
}
const CUMIN: PantryCheckRow = {
  ingredientId: 'cumin',
  name: 'Cumin',
  used: 4,
  unit: 'g',
  pantryQuantity: null,
  default: 'someLeft',
}
const RICE: PantryCheckRow = {
  ingredientId: 'rice',
  name: 'Rice',
  used: 300,
  unit: 'g',
  pantryQuantity: 1000,
  default: 'subtract',
}

function call(input: Record<string, unknown>, household = mcpHousehold()) {
  return setMealStatus.run(
    household,
    setMealStatus.inputSchema.parse({ date: DATE, mealType: 'dinner', ...input }),
    CALLER,
  )
}

describe('set_meal_status cooked on a recipe meal', () => {
  beforeEach(() => {
    vi.mocked(findPlanSlot).mockResolvedValue(RECIPE_SLOT as never)
    vi.mocked(updateEntry).mockResolvedValue({
      id: 'entry-roast',
      status: 'completed',
      pantryDeducted: true,
    } as never)
  })

  it('writes nothing and returns the pantry check when two rows have no amount', async () => {
    vi.mocked(previewCookDeduction).mockResolvedValue([BEETROOT, CUMIN])

    const result = await call({ status: 'cooked' })

    expect(updateEntry).not.toHaveBeenCalled()
    expect(result).toEqual({
      outcome: 'needsPantryCheck',
      date: DATE,
      mealType: 'dinner',
      status: 'cooked',
      meal: { id: 'meal-roast', name: 'Roast' },
      pantryDeducted: false,
      pantryCheck: [
        {
          ingredientId: 'beetroot',
          name: 'Beetroot',
          used: 400,
          unit: 'g',
          pantryQuantity: null,
          default: 'usedUp',
        },
        {
          ingredientId: 'cumin',
          name: 'Cumin',
          used: 4,
          unit: 'g',
          pantryQuantity: null,
          default: 'someLeft',
        },
      ],
      defaultUsedUpIngredientIds: ['beetroot'],
    })
  })

  it('deducts with the household’s used-up ids on the second call', async () => {
    vi.mocked(previewCookDeduction).mockResolvedValue([BEETROOT, CUMIN])

    const result = await call({ status: 'cooked', usedUpIngredientIds: ['beetroot'] })

    expect(updateEntry).toHaveBeenCalledTimes(1)
    expect(updateEntry).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-roast', {
      status: 'completed',
      deductPantry: true,
      usedUpIngredientIds: ['beetroot'],
    })
    expect(result).toMatchObject({ outcome: 'updated', pantryDeducted: true })
    expect(result).not.toHaveProperty('pantryCheck')
  })

  it('takes an empty list as "everything has some left"', async () => {
    vi.mocked(previewCookDeduction).mockResolvedValue([BEETROOT, CUMIN])

    const result = await call({ status: 'cooked', usedUpIngredientIds: [] })

    expect(updateEntry).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-roast', {
      status: 'completed',
      deductPantry: true,
      usedUpIngredientIds: [],
    })
    expect(result).toMatchObject({ outcome: 'updated' })
  })

  it('deducts at once when every row has a known amount', async () => {
    vi.mocked(previewCookDeduction).mockResolvedValue([RICE])

    const result = await call({ status: 'cooked' })

    expect(updateEntry).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-roast', {
      status: 'completed',
      deductPantry: true,
    })
    expect(result).toMatchObject({ outcome: 'updated', pantryDeducted: true })
  })

  it('deducts at once when the meal touches only staples', async () => {
    // The preview leaves staples out, so a staples-only meal has no rows.
    vi.mocked(previewCookDeduction).mockResolvedValue([])

    const result = await call({ status: 'cooked' })

    expect(updateEntry).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ outcome: 'updated' })
  })

  it('asks for the rows in the household’s locale', async () => {
    vi.mocked(previewCookDeduction).mockResolvedValue([{ ...BEETROOT, name: 'Peet' }])

    const result = await call({ status: 'cooked' }, mcpHousehold({ locale: 'et' }))

    expect(previewCookDeduction).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-roast', 'et')
    expect(result).toMatchObject({ pantryCheck: [{ ingredientId: 'beetroot', name: 'Peet' }] })
  })

  it.each(['skipped', 'planned'] as const)('never checks the pantry for %s', async (status) => {
    vi.mocked(findPlanSlot).mockResolvedValue({
      ...RECIPE_SLOT,
      status: status === 'planned' ? 'completed' : 'planned',
    } as never)
    vi.mocked(previewCookDeduction).mockResolvedValue([BEETROOT])

    const result = await call({ status })

    expect(previewCookDeduction).not.toHaveBeenCalled()
    expect(updateEntry).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-roast', {
      status: status === 'skipped' ? 'skipped' : 'planned',
      deductPantry: false,
    })
    expect(result).toMatchObject({ outcome: 'updated', status })
  })

  it('marks a fridge meal cooked with its ids and no pantry check', async () => {
    vi.mocked(findPlanSlot).mockResolvedValue(FRIDGE_SLOT as never)

    const result = await call({ status: 'cooked', usedUpIngredientIds: ['beetroot'] })

    expect(previewCookDeduction).not.toHaveBeenCalled()
    expect(updateEntry).toHaveBeenCalledWith('household-1', 'plan-1', 'entry-roast', {
      status: 'completed',
      usedUpIngredientIds: ['beetroot'],
    })
    expect(result).toMatchObject({ outcome: 'updated', meal: null })
  })
})

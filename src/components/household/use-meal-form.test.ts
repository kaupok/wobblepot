import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import type { MealFormData } from './meal-form-types'
import { useMealForm } from './use-meal-form'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

import { toast } from 'sonner'

const ingredient = (id: string, name: string, defaultUnit: Unit = 'g') => ({
  id,
  name,
  category: 'vegetable' as IngredientCategory,
  defaultUnit,
})

/** A meal with one valid component — the minimum that passes submit validation. */
const validMeal: MealFormData = {
  name: 'Tomato soup',
  kidFriendly: false,
  suitableFor: ['dinner' as MealType],
  servings: 4,
  components: [
    { ingredientId: 'tomato', quantityPerServing: 100, ingredient: ingredient('tomato', 'Tomato') },
  ],
}

/** `handleSubmit` takes a FormEvent; only `preventDefault` is used. */
function submitEvent() {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent
}

function renderForm(meal?: MealFormData, defaultServings?: number) {
  const onSuccess = vi.fn()
  const view = renderHook(() => useMealForm({ meal, defaultServings, onSuccess }))
  return { ...view, onSuccess }
}

async function submit(result: { current: ReturnType<typeof useMealForm> }) {
  await act(async () => {
    await result.current.handleSubmit(submitEvent())
  })
}

describe('useMealForm', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'meal-1' }) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('initial state', () => {
    it('seeds fields from the meal and scales components to total quantities', () => {
      const { result } = renderForm(validMeal)

      expect(result.current.name).toBe('Tomato soup')
      expect(result.current.servings).toBe('4')
      // Stored per-serving, edited as a total across all servings.
      expect(result.current.components[0]?.totalQuantity).toBe(400)
      expect(result.current.isEditing).toBe(false)
      expect(result.current.isImportMode).toBe(false)
    })

    it('falls back to defaultServings, then 4, when the meal has no servings', () => {
      expect(renderForm(undefined, 6).result.current.servings).toBe('6')
      expect(renderForm().result.current.servings).toBe('4')
    })

    it('sorts prefilled ingredient rows unmatched → low-confidence → matched', () => {
      const { result } = renderForm({
        name: 'Imported',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [
          { type: 'matched', ingredient: ingredient('a', 'A'), convertedQuantity: 100 },
          {
            type: 'low-confidence',
            extractedName: 'B?',
            ingredient: ingredient('b', 'B'),
            alternatives: [],
            convertedQuantity: 50,
          },
          { type: 'unmatched', extractedName: 'C', originalText: '1 C' },
        ],
      })

      expect(result.current.ingredientRows.map((r) => r.type)).toEqual([
        'unmatched',
        'low-confidence',
        'matched',
      ])
      expect(result.current.isImportMode).toBe(true)
      expect(result.current.unresolvedCount).toBe(1)
      expect(result.current.lowConfidenceCount).toBe(1)
    })
  })

  describe('validation', () => {
    it('rejects a blank name without calling the API', async () => {
      const { result } = renderForm({ ...validMeal, name: '   ' })

      await submit(result)

      expect(result.current.error).toBe('Name is required')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([
      ['0', 'below the minimum'],
      ['51', 'above the maximum'],
      ['abc', 'unparseable'],
    ])('rejects servings of "%s" (%s)', async (value) => {
      const { result } = renderForm(validMeal)

      act(() => result.current.setServings(value))
      await submit(result)

      expect(result.current.error).toBe('Servings must be between 1 and 50')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('accepts servings at both ends of the allowed range', async () => {
      for (const value of ['1', '50']) {
        const { result } = renderForm(validMeal)
        act(() => result.current.setServings(value))
        await submit(result)
        expect(result.current.error).toBe('')
      }
    })

    it.each(['0', '481'])('rejects a prep time of "%s" minutes', async (value) => {
      const { result } = renderForm(validMeal)

      act(() => result.current.setTimeMinutes(value))
      await submit(result)

      expect(result.current.error).toBe('Prep time must be between 1 and 480 minutes')
      expect(fetchMock).not.toHaveBeenCalled()
      // The guard runs after the submitting flag is set, so it must be cleared.
      expect(result.current.isSubmitting).toBe(false)
    })

    it('surfaces the buildFinalComponents error when there are no ingredients', async () => {
      const { result } = renderForm({ ...validMeal, components: [] })

      await submit(result)

      expect(result.current.error).toBe('Add at least one ingredient')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses to submit while an unmatched import row is unresolved', async () => {
      const { result } = renderForm({
        name: 'Imported',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [{ type: 'unmatched', extractedName: 'Pickled daikon' }],
      })

      await submit(result)

      expect(result.current.error).toMatch(/Resolve unmatched ingredients: Pickled daikon/)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps at least one meal type selected', () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.handleMealTypeToggle('dinner', false))

      expect(result.current.suitableFor).toEqual(['dinner'])
    })
  })

  describe('submission', () => {
    it('POSTs a trimmed payload when creating', async () => {
      const { result, onSuccess } = renderForm(validMeal)

      act(() => {
        result.current.setName('  Tomato soup  ')
        result.current.setDescription('  Warming  ')
        result.current.setSourceUrl('   ')
        result.current.setTimeMinutes('30')
      })
      await submit(result)

      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/households/me/meals')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toMatchObject({
        name: 'Tomato soup',
        description: 'Warming',
        sourceUrl: null,
        timeMinutes: 30,
        servings: 4,
        components: [{ ingredientId: 'tomato', totalQuantity: 400, isVague: false }],
      })
      expect(toast.success).toHaveBeenCalledWith('Meal created')
      expect(onSuccess).toHaveBeenCalled()
    })

    it('PATCHes the meal id when editing', async () => {
      const { result, onSuccess } = renderForm({ ...validMeal, id: 'meal-42' })

      await submit(result)

      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/households/me/meals/meal-42')
      expect(init.method).toBe('PATCH')
      expect(toast.success).toHaveBeenCalledWith('Meal updated')
      expect(onSuccess).toHaveBeenCalled()
    })

    it("surfaces the server's error message and does not call onSuccess", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Name already taken' }),
      })
      const { result, onSuccess } = renderForm(validMeal)

      await submit(result)

      expect(result.current.error).toBe('Name already taken')
      expect(onSuccess).not.toHaveBeenCalled()
      expect(result.current.isSubmitting).toBe(false)
    })

    it('falls back to a generic message when the response carries no error', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      const { result } = renderForm(validMeal)

      await submit(result)

      expect(result.current.error).toBe('Failed to create meal')
    })

    it('clears the submitting flag when fetch itself rejects', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network down'))
      const { result } = renderForm(validMeal)

      await submit(result)

      expect(result.current.error).toBe('Network down')
      expect(result.current.isSubmitting).toBe(false)
    })
  })

  describe('ingredient handlers', () => {
    it('rejects an ingredient that is already on the form', () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.addIngredient(ingredient('tomato', 'Tomato')))

      expect(result.current.components).toHaveLength(1)
      expect(toast.error).toHaveBeenCalled()
    })

    it('defaults a new piece-unit ingredient to 1 and a gram ingredient to 100', () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.addIngredient(ingredient('egg', 'Egg', 'piece')))
      act(() => result.current.addIngredient(ingredient('onion', 'Onion')))

      expect(result.current.components[1]?.totalQuantity).toBe(1)
      expect(result.current.components[2]?.totalQuantity).toBe(100)
    })

    it('marks a component as vague and clears it again on a quantity edit', () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.markComponentAsVague('tomato'))
      expect(result.current.components[0]).toMatchObject({
        isVague: true,
        originalPhrase: 'to taste',
      })

      act(() => result.current.updateComponentQuantity('tomato', 250))
      expect(result.current.components[0]).toMatchObject({
        isVague: false,
        originalPhrase: null,
        totalQuantity: 250,
      })
    })

    it('submits a vague component with a zero quantity', async () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.markComponentAsVague('tomato'))
      await submit(result)

      expect(JSON.parse(fetchMock.mock.calls[0]![1].body).components).toEqual([
        { ingredientId: 'tomato', totalQuantity: 0, isVague: true, originalPhrase: 'to taste' },
      ])
    })

    it('removes a component', () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.removeComponent('tomato'))

      expect(result.current.components).toEqual([])
      expect(result.current.hasIngredients).toBe(false)
    })

    it('resolving an unmatched row turns it into a matched one', () => {
      const { result } = renderForm({
        name: 'Imported',
        kidFriendly: false,
        suitableFor: ['dinner' as MealType],
        prefilledIngredients: [{ type: 'unmatched', extractedName: 'Pickled daikon' }],
      })

      act(() => result.current.handleIngredientRowResolve(0, ingredient('daikon', 'Daikon'), 50))

      expect(result.current.ingredientRows[0]).toEqual({
        type: 'matched',
        ingredient: ingredient('daikon', 'Daikon'),
        totalQuantity: 50,
      })
      expect(result.current.unresolvedCount).toBe(0)
    })
  })

  describe('derived values', () => {
    it('flags duplicate ingredient ids with every index they appear at', () => {
      const { result } = renderForm({
        ...validMeal,
        components: [
          {
            ingredientId: 'tomato',
            quantityPerServing: 100,
            ingredient: ingredient('tomato', 'Tomato'),
          },
          {
            ingredientId: 'onion',
            quantityPerServing: 50,
            ingredient: ingredient('onion', 'Onion'),
          },
          {
            ingredientId: 'tomato',
            quantityPerServing: 75,
            ingredient: ingredient('tomato', 'Tomato'),
          },
        ],
      })

      expect(result.current.duplicateMap.get('tomato')).toEqual([0, 2])
      expect(result.current.duplicateMap.has('onion')).toBe(false)
    })

    it('computes per-serving nutrition and counts unmatched rows', () => {
      const { result } = renderForm({
        ...validMeal,
        servings: 2,
        components: [
          {
            ingredientId: 'tomato',
            quantityPerServing: 200, // → 400 g total across 2 servings
            ingredient: { ...ingredient('tomato', 'Tomato'), calories: 100, protein: 10 },
          },
        ],
      })

      // 200 g per serving → 2 × the per-100 g values.
      expect(result.current.nutritionSummary.nutrition.calories).toBe(200)
      expect(result.current.nutritionSummary.nutrition.protein).toBe(20)
      expect(result.current.nutritionSummary.matchedCount).toBe(1)
      expect(result.current.nutritionSummary.hasVague).toBe(false)
    })

    it('excludes vague components from nutrition but records that they exist', () => {
      const { result } = renderForm({
        ...validMeal,
        components: [
          {
            ingredientId: 'salt',
            quantityPerServing: 1,
            isVague: true,
            ingredient: { ...ingredient('salt', 'Salt'), calories: 0 },
          },
        ],
      })

      expect(result.current.nutritionSummary.matchedCount).toBe(0)
      expect(result.current.nutritionSummary.hasVague).toBe(true)
    })

    it('treats an unparseable servings value as 1 for display maths', () => {
      const { result } = renderForm(validMeal)

      act(() => result.current.setServings(''))

      expect(result.current.servingsNum).toBe(1)
    })
  })
})

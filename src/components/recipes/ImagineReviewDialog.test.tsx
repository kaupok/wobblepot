import { describe, it, expect, vi, afterEach } from 'vitest'
vi.unmock('next-intl')
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import {
  ImagineReviewDialog,
  computeReviewNutrition,
  type ReviewMealData,
} from './ImagineReviewDialog'
import type { IngredientRowData } from './IngredientRow'
import type { PrefilledIngredient } from '@/components/household/meal-form-types'
import { DEFAULT_GRAMS_PER_PIECE } from '@/lib/ai/recipe-quantities'
import { createQueryWrapper } from '@/test/query-wrapper'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  // Unmatched rows search ingredients via TanStack Query.
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

function buildMeal(overrides: Partial<ReviewMealData> = {}): ReviewMealData {
  return {
    name: 'Test meal',
    description: null,
    preparationNotes: null,
    sourceUrl: null,
    timeMinutes: null,
    servings: 4,
    mealTypes: ['dinner'],
    kidFriendly: false,
    prefilledIngredients: [
      {
        type: 'matched',
        ingredient: {
          id: 'chicken-thigh',
          name: 'Chicken thigh',
          category: 'protein',
          defaultUnit: 'g',
          gramsPerPiece: null,
          calories: 200,
          protein: 25,
          carbs: 0,
          fat: 10,
        },
        convertedQuantity: 600,
      },
    ],
    ...overrides,
  }
}

describe('ImagineReviewDialog locale formatting', () => {
  describe('macros', () => {
    // 1000 g at 123.4 kcal/100g for one serving → 1234 kcal.
    const [chicken] = buildMeal().prefilledIngredients as [PrefilledIngredient]
    const bigMeal = buildMeal({
      servings: 1,
      prefilledIngredients: [
        {
          ...chicken,
          ingredient: { ...chicken.ingredient!, calories: 123.4 },
          convertedQuantity: 1000,
        },
      ],
    })

    it('uses comma grouping for thousands in en', () => {
      renderInLocale(
        <ImagineReviewDialog open meal={bigMeal} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
        'en',
      )
      expect(screen.getByText(/1,234 kcal/)).toBeInTheDocument()
    })

    it('does not use the en grouping form in et', () => {
      renderInLocale(
        <ImagineReviewDialog open meal={bigMeal} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
        'et',
      )
      // The Estonian thousands-grouping character depends on the active ICU
      // (NBSP, thin NBSP, or — under small-ICU runtimes — no grouping). What
      // the test guarantees is that the en form (`1,234`) is *not* rendered
      // when locale switches; that's the locale-aware contract this site
      // owes regardless of ICU completeness.
      expect(document.body.textContent ?? '').not.toMatch(/1,234 kcal/)
      // Sanity: the kcal value is still rendered.
      expect(document.body.textContent ?? '').toMatch(/1234.* kcal|1\s234 kcal/)
    })
  })

  // The matched bucket renders inline `<Body>` rows (not `IngredientRow`
  // instances) inside a Radix Collapsible that is closed by default — its
  // content is unmounted until the user opens it. The bucket uses the same
  // `formatQuantity(value, locale, { maximumFractionDigits: 1 })` call as
  // `IngredientRow`, so the locale-aware behaviour of `formatQuantity` is
  // already covered by `IngredientRow.test.tsx`; opening the bucket via a
  // user interaction here would only re-test the same code path.
})

describe('ImagineReviewDialog save-blocked reason', () => {
  const [matched] = buildMeal().prefilledIngredients as [PrefilledIngredient]
  const unmatched: PrefilledIngredient = {
    type: 'unmatched',
    extractedName: 'pickled daikon',
    originalText: '50g pickled daikon',
    extractedQuantity: 50,
    extractedUnit: 'g',
    isVague: false,
    originalPhrase: null,
  }
  const lowConfidence: PrefilledIngredient = {
    type: 'low-confidence',
    extractedName: 'miso',
    originalText: '2 tbsp miso',
    ingredient: {
      id: 'miso-paste',
      name: 'Miso paste',
      category: 'condiment',
      defaultUnit: 'g',
      gramsPerPiece: null,
    },
    convertedQuantity: 30,
    alternatives: [],
    lowConfidence: true,
    isVague: false,
    originalPhrase: null,
  }

  function renderWith(prefilledIngredients: PrefilledIngredient[], locale: 'en' | 'et' = 'en') {
    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ prefilledIngredients })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      locale,
    )
  }

  function expectDescribedSave(name: RegExp, reason: string) {
    const save = screen.getByRole('button', { name })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription(reason)
  }

  it('asks to match or drop unmatched ingredients, pluralised', () => {
    renderWith([matched, unmatched, { ...unmatched, extractedName: 'yuzu' }])
    expectDescribedSave(/^save meal$/i, 'Match or drop 2 ingredients to save')
  })

  it('asks to confirm a single low-confidence ingredient', () => {
    renderWith([matched, lowConfidence])
    expectDescribedSave(/^save meal$/i, 'Confirm 1 ingredient to save')
  })

  it('combines both counts when both kinds are unresolved', () => {
    renderWith([unmatched, lowConfidence])
    expectDescribedSave(/^save meal$/i, 'Match or drop 1 ingredient and confirm 1 to save')
  })

  it('renders the reason in Estonian', () => {
    renderWith([unmatched, unmatched], 'et')
    expectDescribedSave(/^salvesta toit$/i, 'Salvestamiseks sobita või eemalda 2 koostisosa')
  })

  it('shows no reason and no description when everything is matched', () => {
    renderWith([matched])
    const save = screen.getByRole('button', { name: /^save meal$/i })
    expect(save).toBeEnabled()
    expect(save).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/to save$/)).not.toBeInTheDocument()
  })
})

describe('ImagineReviewDialog save failure', () => {
  /** Verbatim from `POST /api/households/me/meals`'s catch-all branch. */
  const SERVER_PROSE = 'Failed to create meal'

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubFetch(impl: () => Promise<unknown>) {
    vi.stubGlobal('fetch', vi.fn(impl))
  }

  async function saveInEt() {
    const onSaved = vi.fn()
    renderInLocale(
      <ImagineReviewDialog open meal={buildMeal()} onOpenChange={vi.fn()} onSaved={onSaved} />,
      'et',
    )
    fireEvent.click(screen.getByRole('button', { name: etMessages.recipes.review.save }))
    await screen.findByText(etMessages.recipes.review.errors.saveFailed)
    return onSaved
  }

  it('renders Estonian, not the server prose, and logs the server error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: SERVER_PROSE }),
      }),
    )

    const onSaved = await saveInEt()

    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[imagine-review] save failed', {
      status: 500,
      error: SERVER_PROSE,
    })
  })

  it('renders Estonian, not the browser message, on a network failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    await saveInEt()

    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})

// HON-714: the API rejects a repeated ingredient, and the generic save error
// only invites a retry that resends the same rows. Refuse before the request.
describe('ImagineReviewDialog duplicate ingredients', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks saving and says why when two rows match the same ingredient', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const [matched] = buildMeal().prefilledIngredients as [PrefilledIngredient]
    const onSaved = vi.fn()

    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ prefilledIngredients: [matched, matched] })}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
      'et',
    )
    fireEvent.click(screen.getByRole('button', { name: etMessages.recipes.review.save }))

    expect(
      await screen.findByText(etMessages.recipes.form.errors.duplicateIngredients),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('ImagineReviewDialog ingredient cap', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks saving more than 50 ingredients and says why', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const [matched] = buildMeal().prefilledIngredients as [PrefilledIngredient]
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...matched,
      ingredient: { ...matched.ingredient!, id: `ing-${i}`, name: `Ingredient ${i}` },
    }))

    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ prefilledIngredients: rows })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      'et',
    )
    fireEvent.click(screen.getByRole('button', { name: etMessages.recipes.review.save }))

    expect(await screen.findByText('Toidul saab olla kuni 50 koostisosa')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// HON-721: the macro line is derived from the live rows, through the same
// `computeMealNutrition` the save endpoint uses, instead of the imagine
// response's `nutrition` — which predates the AI quantity review and never
// sees a row edit or removal.
describe('computeReviewNutrition', () => {
  const grams = (overrides: Partial<Extract<IngredientRowData, { type: 'matched' }>> = {}) =>
    ({
      type: 'matched',
      ingredient: {
        id: 'rice',
        name: 'Rice',
        category: 'carb',
        defaultUnit: 'g',
        gramsPerPiece: null,
        calories: 350,
        protein: 7,
        carbs: 78,
        fat: 1,
      },
      totalQuantity: 400,
      ...overrides,
    }) satisfies IngredientRowData

  const eggs: IngredientRowData = {
    type: 'matched',
    ingredient: {
      id: 'egg',
      name: 'Egg',
      category: 'protein',
      defaultUnit: 'piece',
      gramsPerPiece: 55,
      calories: 155,
      protein: 13,
      carbs: 1,
      fat: 11,
    },
    totalQuantity: 8,
  }

  it('divides by servings and scales per-100g macros for gram rows', () => {
    // 400 g / 4 servings = 100 g per serving.
    expect(computeReviewNutrition([grams()], 4)).toEqual({
      calories: 350,
      protein: 7,
      carbs: 78,
      fat: 1,
    })
  })

  it('converts piece rows through gramsPerPiece, as the save endpoint does', () => {
    // 8 eggs / 4 servings = 2 eggs × 55 g = 110 g per serving.
    expect(computeReviewNutrition([eggs], 4)?.calories).toBeCloseTo(170.5)
  })

  it('falls back to the default piece weight when gramsPerPiece is missing', () => {
    const row = {
      ...eggs,
      ingredient: { ...eggs.ingredient, gramsPerPiece: null },
    } as IngredientRowData
    expect(computeReviewNutrition([row], 4)?.calories).toBeCloseTo(
      (2 * DEFAULT_GRAMS_PER_PIECE * 155) / 100,
    )
  })

  it('counts low-confidence rows and skips vague and unmatched ones', () => {
    const rows: IngredientRowData[] = [
      grams(),
      { ...grams(), type: 'low-confidence', extractedName: 'rice', alternatives: [] },
      grams({ isVague: true, originalPhrase: 'to taste' }),
      {
        type: 'unmatched',
        extractedName: 'yuzu',
        originalText: '1 yuzu',
        extractedQuantity: 1,
        extractedUnit: '',
      },
    ]
    expect(computeReviewNutrition(rows, 4)?.calories).toBe(700)
  })

  it('returns null rather than a partial total when a counted row has no macros', () => {
    // A row picked from the low-confidence alternatives carries no macros.
    const bare = grams({
      ingredient: { id: 'miso', name: 'Miso', category: 'condiment', defaultUnit: 'g' },
    })
    expect(computeReviewNutrition([grams(), bare], 4)).toBeNull()
  })

  it('ignores missing macros on a vague row, which contributes nothing anyway', () => {
    const bareVague = grams({
      ingredient: { id: 'salt', name: 'Salt', category: 'condiment', defaultUnit: 'g' },
      isVague: true,
    })
    expect(computeReviewNutrition([grams(), bareVague], 4)?.calories).toBe(350)
  })

  it('returns null when there is nothing to sum', () => {
    expect(computeReviewNutrition([], 4)).toBeNull()
    expect(computeReviewNutrition([grams({ isVague: true })], 4)).toBeNull()
  })
})

describe('ImagineReviewDialog macro line', () => {
  const [chicken] = buildMeal().prefilledIngredients as [PrefilledIngredient]
  // 30 g of miso across 4 servings at 200 kcal/100g → 15 kcal per serving.
  const miso: PrefilledIngredient = {
    type: 'low-confidence',
    extractedName: 'miso',
    originalText: '2 tbsp miso',
    ingredient: {
      id: 'miso-paste',
      name: 'Miso paste',
      category: 'condiment',
      defaultUnit: 'g',
      gramsPerPiece: null,
      calories: 200,
      protein: 12,
      carbs: 26,
      fat: 6,
    },
    convertedQuantity: 30,
    alternatives: [
      {
        id: 'hikari',
        name: 'White miso (Hikari)',
        category: 'condiment',
        defaultUnit: 'g',
        similarity: 0.8,
      },
    ],
    lowConfidence: true,
    isVague: false,
    originalPhrase: null,
  }

  function renderMeal(prefilledIngredients: PrefilledIngredient[]) {
    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ prefilledIngredients })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      'en',
    )
  }

  // See `QuantityControls.stories.tsx`: a controlled number input on React 19
  // needs the native setter plus a bubbling `input` event.
  function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('reflects the quantities the dialog opens with, i.e. after the AI review', () => {
    // 600 g / 4 = 150 g of chicken at 200 kcal, 25 g protein, 10 g fat per 100g.
    renderMeal([chicken])
    expect(screen.getByText('300 kcal · 38g protein · 0g carbs · 15g fat')).toBeInTheDocument()
  })

  it('recomputes after a row quantity edit', () => {
    renderMeal([chicken, miso])
    expect(screen.getByText(/^315 kcal/)).toBeInTheDocument()

    setInputValue(screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement, '60')

    expect(screen.getByText(/^330 kcal/)).toBeInTheDocument()
  })

  it('recomputes after a row removal', () => {
    renderMeal([chicken, miso])
    expect(screen.getByText(/^315 kcal/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove ingredient' }))

    expect(screen.getByText(/^300 kcal/)).toBeInTheDocument()
  })

  it('hides the line instead of rendering zeros when the ingredients carry no macros', () => {
    const { calories: _c, protein: _p, carbs: _cb, fat: _f, ...bare } = chicken.ingredient!
    renderMeal([{ ...chicken, ingredient: bare }])
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument()
  })
})

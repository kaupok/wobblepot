import { afterEach, describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { fireEvent, screen, waitFor } from '@testing-library/react'

import type { PrefilledIngredient } from '@/components/household/meal-form-types'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ImagineReviewDialog } from './ImagineReviewDialog'
import { buildMeal, renderInLocale } from './ImagineReviewDialog.fixtures'

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

describe('ImagineReviewDialog vague phrases and unnamed rows (HON-917)', () => {
  it('renders a matched vague phrase in Estonian', () => {
    const [chicken] = buildMeal().prefilledIngredients as [PrefilledIngredient]
    const meal = buildMeal({
      prefilledIngredients: [{ ...chicken, isVague: true, originalPhrase: 'to taste' }],
    })
    renderInLocale(
      <ImagineReviewDialog open meal={meal} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      'et',
    )
    fireEvent.click(screen.getByText('1 sobitatud koostisosa'))
    expect(screen.getByText('maitse järgi')).toBeInTheDocument()
  })

  it('labels an unmatched row the parser returned without a name in Estonian', () => {
    const meal = buildMeal({
      prefilledIngredients: [
        { type: 'unmatched', originalText: '1 midagi', isVague: false, originalPhrase: null },
      ],
    })
    renderInLocale(
      <ImagineReviewDialog open meal={meal} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      'et',
    )
    expect(screen.getByText('Tundmatu koostisosa')).toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })
})

describe('ImagineReviewDialog prep time', () => {
  it('renders a zero-minute meal exactly like one with no prep time, with no stray "0" (HON-711)', () => {
    const renderWith = (timeMinutes: number | null) =>
      renderInLocale(
        <ImagineReviewDialog
          open
          meal={buildMeal({ timeMinutes })}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />,
        'en',
      )
    const zero = renderWith(0)
    const zeroText = screen.getByRole('dialog').textContent
    zero.unmount()
    renderWith(null)

    expect(zeroText).toBe(screen.getByRole('dialog').textContent)
  })

  it('shows a fractional prep time rounded, as it will be saved (HON-891)', () => {
    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ timeMinutes: 12.5 })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      'en',
    )
    expect(screen.getByText('13 min')).toBeInTheDocument()
  })

  it('renders an over-480 prep time exactly like an unknown one (HON-891)', () => {
    const renderWith = (timeMinutes: number | null) =>
      renderInLocale(
        <ImagineReviewDialog
          open
          meal={buildMeal({ timeMinutes })}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />,
        'en',
      )
    const over = renderWith(600)
    const overText = screen.getByRole('dialog').textContent
    over.unmount()
    renderWith(null)

    expect(overText).toBe(screen.getByRole('dialog').textContent)
  })

  describe('save payload', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    async function savedTimeMinutes(timeMinutes: number | null) {
      const fetchMock = vi.fn(() =>
        Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 'meal-1' }) }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const onSaved = vi.fn()
      renderInLocale(
        <ImagineReviewDialog
          open
          meal={buildMeal({ timeMinutes })}
          onOpenChange={vi.fn()}
          onSaved={onSaved}
        />,
        'en',
      )
      fireEvent.click(screen.getByRole('button', { name: /^save recipe$/i }))
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      return JSON.parse(init.body as string).timeMinutes
    }

    it('sends a zero-minute meal as unknown, which the create route accepts (HON-711)', async () => {
      expect(await savedTimeMinutes(0)).toBeNull()
    })

    it('sends a known prep time unchanged', async () => {
      expect(await savedTimeMinutes(25)).toBe(25)
    })

    it('rounds a fractional prep time to the integer the create route accepts (HON-891)', async () => {
      expect(await savedTimeMinutes(12.5)).toBe(13)
    })

    it('sends a prep time over 480 minutes as unknown (HON-891)', async () => {
      expect(await savedTimeMinutes(600)).toBeNull()
    })

    it.each([
      [480.4, 480],
      [480.5, null],
      [0.6, 1],
      [0.4, null],
    ])('applies the 1–480 range after rounding: %s is sent as %s (HON-891)', async (raw, sent) => {
      expect(await savedTimeMinutes(raw)).toBe(sent)
    })
  })
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
    expectDescribedSave(/^save recipe$/i, 'Match or drop 2 ingredients to save')
  })

  it('asks to confirm a single low-confidence ingredient', () => {
    renderWith([matched, lowConfidence])
    expectDescribedSave(/^save recipe$/i, 'Confirm 1 ingredient to save')
  })

  it('combines both counts when both kinds are unresolved', () => {
    renderWith([unmatched, lowConfidence])
    expectDescribedSave(/^save recipe$/i, 'Match or drop 1 ingredient and confirm 1 to save')
  })

  it('renders the reason in Estonian', () => {
    renderWith([unmatched, unmatched], 'et')
    expectDescribedSave(/^salvesta retsept$/i, 'Salvestamiseks sobita või eemalda 2 koostisosa')
  })

  it('shows no reason and no description when everything is matched', () => {
    renderWith([matched])
    const save = screen.getByRole('button', { name: /^save recipe$/i })
    expect(save).toBeEnabled()
    expect(save).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/to save$/)).not.toBeInTheDocument()
  })
})

describe('ImagineReviewDialog save failure', () => {
  /** Verbatim from `POST /api/households/me/meals`'s catch-all branch. */
  const SERVER_PROSE = 'Failed to create recipe'

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

// HON-773: the shared meal validator returned English prose that the dialog
// rendered verbatim.
describe('ImagineReviewDialog validation errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('says in Estonian that a meal needs an ingredient', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ prefilledIngredients: [] })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      'et',
    )
    fireEvent.click(screen.getByRole('button', { name: etMessages.recipes.review.save }))

    expect(
      await screen.findByText(etMessages.recipes.form.errors.noIngredients),
    ).toBeInTheDocument()
    expect(screen.queryByText(enMessages.recipes.form.errors.noIngredients)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
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

    expect(await screen.findByText('Retseptil saab olla kuni 50 koostisosa')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// HON-721 derives the numbers from the live rows; HON-1367 shows them as the
// `NutritionSummary` every other meal view uses, not a one-line string.
describe('ImagineReviewDialog nutrition summary', () => {
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

  const legend = (macro: string) =>
    document.querySelector(`[data-macro="${macro}"]`)?.textContent ?? null

  it('reflects the quantities the dialog opens with, i.e. after the AI review', () => {
    // 600 g / 4 = 150 g of chicken at 200 kcal, 25 g protein, 10 g fat per 100g.
    renderMeal([chicken])
    expect(screen.getByText('300 kcal')).toBeInTheDocument()
    expect(screen.getByText('per serving')).toBeInTheDocument()
    expect(legend('protein')).toBe('38gProtein')
    expect(legend('carbs')).toBe('0gCarbs')
    expect(legend('fat')).toBe('15gFat')
    expect(screen.getByText(enMessages.common.nutritionDisclaimer)).toBeInTheDocument()
    expect(screen.queryByText(/kcal · /)).not.toBeInTheDocument()
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

  it('hides the summary while a row is unmatched and shows it once the row is dropped', () => {
    renderMeal([
      chicken,
      {
        type: 'unmatched',
        extractedName: 'yuzu',
        originalText: '1 yuzu',
        extractedQuantity: 1,
        extractedUnit: '',
        isVague: false,
        originalPhrase: null,
      },
    ])
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^drop$/i }))

    expect(screen.getByText(/^300 kcal/)).toBeInTheDocument()
  })

  it('hides the summary instead of rendering zeros when the ingredients carry no macros', () => {
    const { calories: _c, protein: _p, carbs: _cb, fat: _f, ...bare } = chicken.ingredient!
    renderMeal([{ ...chicken, ingredient: bare }])
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument()
    expect(screen.queryByText(enMessages.common.nutritionDisclaimer)).not.toBeInTheDocument()
  })
})

// Every quantity in the dialog is per serving, so it says how many it makes.
describe('ImagineReviewDialog servings', () => {
  it.each([
    ['en', 4, 'Makes 4 servings'],
    ['en', 1, 'Makes 1 serving'],
    ['et', 4, 'Annab 4 portsjonit'],
  ] as const)('shows the count in %s for %i', (locale, servings, text) => {
    renderInLocale(
      <ImagineReviewDialog
        open
        meal={buildMeal({ servings })}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
      locale,
    )
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})

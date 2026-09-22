import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ImagineReviewDialog, type ReviewMealData } from './ImagineReviewDialog'
import type { PrefilledIngredient } from '@/components/household/meal-form-types'
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
        },
        convertedQuantity: 600,
      },
    ],
    nutrition: { calories: 1234, protein: 56, carbs: 78, fat: 12 },
    ...overrides,
  }
}

describe('ImagineReviewDialog locale formatting', () => {
  describe('macros', () => {
    it('uses comma grouping for thousands in en', () => {
      renderInLocale(
        <ImagineReviewDialog open meal={buildMeal()} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
        'en',
      )
      expect(screen.getByText(/1,234 kcal/)).toBeInTheDocument()
    })

    it('does not use the en grouping form in et', () => {
      renderInLocale(
        <ImagineReviewDialog open meal={buildMeal()} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
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

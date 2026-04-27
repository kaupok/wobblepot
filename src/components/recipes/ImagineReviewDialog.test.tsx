import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { ImagineReviewDialog, type ReviewMealData } from './ImagineReviewDialog'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
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

  // The matched bucket on this dialog renders inside a Radix Collapsible that
  // is closed by default — its content is unmounted, so the per-serving line
  // is not in the DOM until the user opens it. The render path itself is
  // identical to the `IngredientRow` matched render and is already covered by
  // `IngredientRow.test.tsx`. Asserting here would just duplicate coverage.
})

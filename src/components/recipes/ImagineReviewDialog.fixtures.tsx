import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import type { ReviewMealData } from './ImagineReviewDialog'
import { createQueryWrapper } from '@/test/query-wrapper'

// A test file that uses these calls `vi.unmock('next-intl')` first: the copy
// is resolved against the real catalog in a real locale.
export function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
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

export function buildMeal(overrides: Partial<ReviewMealData> = {}): ReviewMealData {
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

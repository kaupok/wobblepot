import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { vi } from 'vitest'

import { createPantryItem, lemonGarlicChickenComponents } from '@/stories/fixtures'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { PantryDeductionModal } from './PantryDeductionModal'

// Shared by the `PantryDeductionModal.*.test.tsx` files. Each test file calls
// `vi.unmock('next-intl')` itself, because a mock is per file.

// Chicken thigh is 150 g a serving, so 8 servings (1200 g) use up the 800 g.
const chickenThigh = createPantryItem({ ingredientId: 'chicken-thigh', quantity: 800 })

export function renderModal(
  props: Partial<Parameters<typeof PantryDeductionModal>[0]> = {},
  locale: 'en' | 'et' = 'en',
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      <PantryDeductionModal
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        mealName="Roast chicken"
        components={lemonGarlicChickenComponents}
        householdServings={8}
        pantryItems={[chickenThigh]}
        {...props}
      />
    </NextIntlClientProvider>,
  )
}

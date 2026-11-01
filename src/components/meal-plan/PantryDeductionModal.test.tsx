// The real next-intl: the global mock in vitest.setup.ts reads English only, and
// the "used up" word is asserted in both locales (HON-1522).
import { describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import { createPantryItem, lemonGarlicChickenComponents } from '@/stories/fixtures'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { PantryDeductionModal } from './PantryDeductionModal'

// Chicken thigh is 150 g a serving, so 8 servings (1200 g) use up the 800 g.
const chickenThigh = createPantryItem({ ingredientId: 'chicken-thigh', quantity: 800 })

function renderModal(
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

describe('PantryDeductionModal', () => {
  it('says "cooked", not "completed", when it deducts', async () => {
    renderModal()

    const dialog = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(dialog).toHaveTextContent(
      'Marking "Roast chicken" as cooked takes these from your pantry:',
    )
    expect(dialog).not.toHaveTextContent(/completed/i)
  })

  it('reads "used up" in the muted tone for an item that runs out', async () => {
    renderModal()

    const row = (await screen.findByText('Chicken thigh')).closest('li')
    expect(row).toHaveTextContent('800g → used up')
    const amount = screen.getByText('800g → used up')
    expect(amount).toHaveClass('text-muted-foreground')
    expect(row?.querySelector('.text-destructive')).toBeNull()
  })

  it('reads "otsas" in Estonian for an item that runs out', async () => {
    renderModal({}, 'et')

    await screen.findByRole('dialog', { name: 'Märgi tehtuks' })
    expect(screen.getByText('800g → otsas')).toBeInTheDocument()
  })

  it('says "cooked" when nothing is deducted', async () => {
    renderModal({ pantryItems: [] })

    const dialog = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(dialog).toHaveTextContent('Mark "Roast chicken" as cooked? Your pantry does not change.')
    expect(dialog).not.toHaveTextContent(/completed/i)
  })
})

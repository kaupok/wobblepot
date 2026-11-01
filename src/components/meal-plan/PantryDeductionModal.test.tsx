// The real next-intl: the global mock in vitest.setup.ts reads English only, and
// the "Ran out" word is asserted in both locales (HON-1522).
import { describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import { createPantryItem, lemonGarlicChickenComponents } from '@/stories/fixtures'
import {
  fetaComponent,
  fetaPantryItem,
  HAVE_SOME_SERVINGS,
  haveSomeComponents,
  haveSomePantryItems,
} from '@/stories/have-some-fixtures'

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

  it('reads "Ran out" in the muted tone for a known item that runs out', async () => {
    renderModal()

    const row = (await screen.findByText('Chicken thigh')).closest('li')
    expect(row).toHaveTextContent('800g → Ran out')
    const amount = screen.getByText('800g → Ran out')
    expect(amount).toHaveClass('text-muted-foreground')
    expect(row?.querySelector('.text-destructive')).toBeNull()
  })

  it('reads "Otsas" in Estonian for a known item that runs out', async () => {
    renderModal({}, 'et')

    await screen.findByRole('dialog', { name: 'Märgi tehtuks' })
    expect(screen.getByText('800g → Otsas')).toBeInTheDocument()
  })

  it('reads "Ran out" for a known item that lands exactly on zero', async () => {
    // 4 servings × 200 g of chicken thigh is the whole 800 g.
    renderModal({
      householdServings: 4,
      components: [{ ...lemonGarlicChickenComponents[0]!, quantityPerServing: 200 }],
    })

    expect(await screen.findByText('800g → Ran out')).toBeInTheDocument()
  })

  it('confirms with no answer when no row is "have some"', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderModal({ onConfirm })

    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledWith()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  describe('"have some" rows (HON-1564)', () => {
    function renderHaveSome(props: Partial<Parameters<typeof PantryDeductionModal>[0]> = {}) {
      const onConfirm = vi.fn()
      renderModal({
        onConfirm,
        mealName: 'Roast vegetable bowl',
        components: haveSomeComponents,
        householdServings: HAVE_SOME_SERVINGS,
        pantryItems: haveSomePantryItems,
        ...props,
      })
      return { onConfirm }
    }

    const choiceOf = (name: string) =>
      within(screen.getByRole('radiogroup', { name: `What is left: ${name}` })).getByRole('radio', {
        checked: true,
      }).textContent

    it('presets the fresh vegetables at "Used up" and the cupboard items at "Some left"', async () => {
      renderHaveSome()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      expect(screen.getAllByRole('radiogroup')).toHaveLength(11)
      for (const name of ['Pumpkin', 'Carrot', 'Sweet potato', 'Beetroot']) {
        expect(choiceOf(name)).toBe('Used up')
      }
      for (const name of [
        'Cumin',
        'Smoked paprika',
        'Tahini',
        'Quinoa',
        'Chickpeas',
        'Pumpkin seeds',
        'Lemon',
      ]) {
        expect(choiceOf(name)).toBe('Some left')
      }
    })

    it('shows no control on a known-quantity row', async () => {
      renderHaveSome({
        components: [...haveSomeComponents, fetaComponent],
        pantryItems: [...haveSomePantryItems, fetaPantryItem],
      })

      const feta = (await screen.findByText('Feta')).closest('li')!
      expect(feta).toHaveTextContent('100g → Ran out')
      expect(within(feta).queryByRole('radiogroup')).toBeNull()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(11)
    })

    it('sends the ids left at "Used up" on Confirm', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderHaveSome()

      await user.click(await screen.findByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: ['pumpkin', 'carrot', 'sweet-potato', 'beetroot'],
        someLeftCount: 7,
      })
    })

    it('sends the switched set after the cook changes two rows', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderHaveSome()

      const tahini = await screen.findByRole('radiogroup', { name: 'What is left: Tahini' })
      await user.click(within(tahini).getByRole('radio', { name: 'Used up' }))
      const carrot = screen.getByRole('radiogroup', { name: 'What is left: Carrot' })
      await user.click(within(carrot).getByRole('radio', { name: 'Some left' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: ['pumpkin', 'sweet-potato', 'beetroot', 'tahini'],
        someLeftCount: 7,
      })
    })

    it('sends an empty list when every row has some left', async () => {
      const user = userEvent.setup()
      const cupboard = haveSomePantryItems.filter((item) =>
        ['cumin', 'tahini', 'quinoa'].includes(item.ingredientId),
      )
      const { onConfirm } = renderHaveSome({ pantryItems: cupboard })

      await user.click(await screen.findByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({ usedUpIngredientIds: [], someLeftCount: 3 })
    })

    it('reaches the control by Tab and changes it with an arrow key and Space', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderHaveSome({
        pantryItems: haveSomePantryItems.filter((item) => item.ingredientId === 'pumpkin'),
      })
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      // Focus starts in the dialog; Tab until the pumpkin's checked radio.
      const usedUp = screen.getByRole('radio', { name: 'Used up' })
      for (let i = 0; i < 5 && document.activeElement !== usedUp; i++) await user.tab()
      expect(usedUp).toHaveFocus()

      // jsdom does not check a Radix radio on arrow focus, as a browser does,
      // so Space picks the focused option.
      const someLeft = screen.getByRole('radio', { name: 'Some left' })
      await user.keyboard('{ArrowRight}')
      expect(someLeft).toHaveFocus()
      await user.keyboard(' ')
      expect(someLeft).toBeChecked()

      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(onConfirm).toHaveBeenCalledWith({ usedUpIngredientIds: [], someLeftCount: 1 })
    })

    it('reads the options in Estonian', async () => {
      renderModal(
        {
          components: haveSomeComponents,
          householdServings: HAVE_SOME_SERVINGS,
          pantryItems: haveSomePantryItems.slice(0, 1),
        },
        'et',
      )

      const group = await screen.findByRole('radiogroup', { name: 'Mis alles jäi: Pumpkin' })
      expect(within(group).getByRole('radio', { name: 'Otsas' })).toBeChecked()
      expect(within(group).getByRole('radio', { name: 'Jäi alles' })).not.toBeChecked()
    })
  })

  it('says "cooked" when nothing is deducted', async () => {
    renderModal({ pantryItems: [] })

    const dialog = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(dialog).toHaveTextContent('Mark "Roast chicken" as cooked? Your pantry does not change.')
    expect(dialog).not.toHaveTextContent(/completed/i)
  })
})

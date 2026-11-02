// The real next-intl: the global mock in vitest.setup.ts reads English only, and
// the "Ran out" word is asserted in both locales (HON-1522).
import { describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import { createPantryItem, lemonGarlicChickenComponents } from '@/stories/fixtures'
import {
  chiliPantryItem,
  chiliToTasteComponent,
  fetaComponent,
  fetaPantryItem,
  HAVE_SOME_SERVINGS,
  haveSomeComponents,
  haveSomePantryItems,
  minceComponent,
  mincePantryItem,
  onionComponent,
  onionPantryItem,
  saltComponent,
  saltPantryItem,
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

  it('confirms with no answer when nothing is deducted', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderModal({ onConfirm, pantryItems: [] })

    await user.click(await screen.findByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledWith()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  describe('known-amount rows (HON-1583)', () => {
    function renderKnown() {
      const onConfirm = vi.fn()
      renderModal({
        onConfirm,
        mealName: 'Bolognese',
        components: [minceComponent, fetaComponent],
        householdServings: HAVE_SOME_SERVINGS,
        pantryItems: [mincePantryItem, fetaPantryItem],
      })
      return { onConfirm }
    }

    const group = (name: string) =>
      screen.getByRole('radiogroup', { name: `What is left: ${name}` })
    const row = (name: string) => screen.getByText(name).closest('li')!

    it('opens a row with some left at "Some left" and a row that runs out at "Used up"', async () => {
      renderKnown()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      expect(row('Beef mince')).toHaveTextContent('1000g → 500g')
      expect(within(group('Beef mince')).getByRole('radio', { name: 'Some left' })).toBeChecked()
      expect(row('Feta')).toHaveTextContent('100g → Ran out')
      expect(within(group('Feta')).getByRole('radio', { name: 'Used up' })).toBeChecked()
    })

    // The server subtracts from the live pantry, so a preset row is not named:
    // a restock while the dialog is open still counts.
    it('leaves the preset rows to the server on Confirm and counts them', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderKnown()

      await user.click(await screen.findByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: [],
        someLeftIngredientIds: [],
        lowIngredientIds: [],
        usedUpCount: 1,
        someLeftCount: 1,
        lowCount: 0,
        stapleRows: 0,
      })
    })

    it('reads "Ran out" and sends the id as used up when the cook switches a row with some left', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderKnown()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(within(group('Beef mince')).getByRole('radio', { name: 'Used up' }))
      expect(row('Beef mince')).toHaveTextContent('1000g → Ran out')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: ['mince'],
        someLeftIngredientIds: [],
        lowIngredientIds: [],
        usedUpCount: 2,
        someLeftCount: 0,
        lowCount: 0,
        stapleRows: 0,
      })
    })

    it('reads "some" and sends the id as some left when the cook switches a row that runs out', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderKnown()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(within(group('Feta')).getByRole('radio', { name: 'Some left' }))
      expect(row('Feta')).toHaveTextContent('100g → some')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: [],
        someLeftIngredientIds: ['feta'],
        lowIngredientIds: [],
        usedUpCount: 0,
        someLeftCount: 2,
        lowCount: 0,
        stapleRows: 0,
      })
    })

    it('reaches each control by Tab', async () => {
      const user = userEvent.setup()
      renderKnown()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      const minceChecked = within(group('Beef mince')).getByRole('radio', { name: 'Some left' })
      for (let i = 0; i < 6 && document.activeElement !== minceChecked; i++) await user.tab()
      expect(minceChecked).toHaveFocus()
      await user.tab()
      expect(within(group('Feta')).getByRole('radio', { name: 'Used up' })).toHaveFocus()
    })
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

    it('shows the amount beside the control on a known-quantity row only', async () => {
      renderHaveSome({
        components: [...haveSomeComponents, fetaComponent],
        pantryItems: [...haveSomePantryItems, fetaPantryItem],
      })

      const feta = (await screen.findByText('Feta')).closest('li')!
      expect(feta).toHaveTextContent('100g → Ran out')
      expect(within(feta).getByRole('radiogroup')).toBeInTheDocument()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(12)
      expect(screen.getByText('Pumpkin').closest('li')).not.toHaveTextContent('→')
    })

    it('sends the ids left at "Used up" on Confirm', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderHaveSome()

      await user.click(await screen.findByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: ['pumpkin', 'carrot', 'sweet-potato', 'beetroot'],
        someLeftIngredientIds: [],
        lowIngredientIds: [],
        usedUpCount: 4,
        someLeftCount: 7,
        lowCount: 0,
        stapleRows: 0,
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
        someLeftIngredientIds: [],
        lowIngredientIds: [],
        usedUpCount: 4,
        someLeftCount: 7,
        lowCount: 0,
        stapleRows: 0,
      })
    })

    it('sends an empty list when every row has some left', async () => {
      const user = userEvent.setup()
      const cupboard = haveSomePantryItems.filter((item) =>
        ['cumin', 'tahini', 'quinoa'].includes(item.ingredientId),
      )
      const { onConfirm } = renderHaveSome({ pantryItems: cupboard })

      await user.click(await screen.findByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: [],
        someLeftIngredientIds: [],
        lowIngredientIds: [],
        usedUpCount: 0,
        someLeftCount: 3,
        lowCount: 0,
        stapleRows: 0,
      })
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
      // so Space picks the focused option. Three chips: Used up, Running low,
      // Some left (HON-1588).
      const runningLow = screen.getByRole('radio', { name: 'Running low' })
      const someLeft = screen.getByRole('radio', { name: 'Some left' })
      await user.keyboard('{ArrowRight}')
      expect(runningLow).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(someLeft).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(runningLow).toHaveFocus()
      await user.keyboard(' ')
      expect(runningLow).toBeChecked()

      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: [],
        someLeftIngredientIds: [],
        lowIngredientIds: ['pumpkin'],
        usedUpCount: 0,
        someLeftCount: 0,
        lowCount: 1,
        stapleRows: 0,
      })
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

  describe('"Running low" and staple rows (HON-1588)', () => {
    const group = (name: string) =>
      screen.getByRole('radiogroup', { name: `What is left: ${name}` })
    const row = (name: string) => screen.getByText(name).closest('li')!
    const checked = (name: string) =>
      within(group(name)).getByRole('radio', { checked: true }).textContent

    function renderMixed(pantryOverrides: Partial<Record<string, { low: boolean }>> = {}) {
      const onConfirm = vi.fn()
      const tahini = haveSomePantryItems.find((item) => item.ingredientId === 'tahini')!
      const items = [tahini, mincePantryItem, fetaPantryItem, onionPantryItem, saltPantryItem]
      renderModal({
        onConfirm,
        mealName: 'Bowl',
        components: [
          haveSomeComponents.find((c) => c.ingredientId === 'tahini')!,
          minceComponent,
          fetaComponent,
          onionComponent,
          saltComponent,
          chiliToTasteComponent,
        ],
        householdServings: HAVE_SOME_SERVINGS,
        pantryItems: [
          ...items.map((item) => ({ ...item, ...pantryOverrides[item.ingredientId] })),
          chiliPantryItem,
        ],
      })
      return { onConfirm }
    }

    it('gives a "have some" row three chips, opened at its default', async () => {
      renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      expect(
        within(group('Tahini'))
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['Used up', 'Running low', 'Some left'])
      expect(checked('Tahini')).toBe('Some left')
    })

    it('reads "1000g → 500g, running low" on a known row switched to "Running low"', async () => {
      const user = userEvent.setup()
      renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(within(group('Beef mince')).getByRole('radio', { name: 'Running low' }))

      expect(row('Beef mince')).toHaveTextContent('1000g → 500g, running low')
    })

    it('reads "→ a little" on a known row the meal empties, and on a "have some" row', async () => {
      const user = userEvent.setup()
      renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(within(group('Feta')).getByRole('radio', { name: 'Running low' }))
      await user.click(within(group('Tahini')).getByRole('radio', { name: 'Running low' }))

      expect(row('Feta')).toHaveTextContent('100g → a little')
      expect(row('Tahini')).toHaveTextContent('→ a little')
    })

    it('opens a staple at "Some left" with the star and no subtraction', async () => {
      renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      expect(checked('Onion')).toBe('Some left')
      expect(row('Onion')).toHaveTextContent('Staple')
      expect(row('Onion').querySelector('svg.fill-warning')).not.toBeNull()
      expect(row('Onion')).not.toHaveTextContent('→')
    })

    it('lists no row for a starter staple or a "to taste" staple', async () => {
      renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      expect(screen.queryByText('Salt')).toBeNull()
      expect(screen.queryByText('Chili flakes')).toBeNull()
      expect(screen.getAllByRole('radiogroup')).toHaveLength(4)
    })

    it('opens a row that is already low at "Running low"', async () => {
      renderMixed({ mince: { low: true }, onion: { low: true } })
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      expect(checked('Beef mince')).toBe('Running low')
      expect(checked('Onion')).toBe('Running low')
      expect(checked('Tahini')).toBe('Some left')
    })

    it('sends onion as low and tahini as used up', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(within(group('Onion')).getByRole('radio', { name: 'Running low' }))
      await user.click(within(group('Tahini')).getByRole('radio', { name: 'Used up' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenCalledWith({
        usedUpIngredientIds: ['tahini'],
        someLeftIngredientIds: [],
        lowIngredientIds: ['onion'],
        usedUpCount: 2,
        someLeftCount: 1,
        lowCount: 1,
        stapleRows: 1,
      })
    })

    it('sends a staple at "Used up" as used up, and no low list when all rows keep their preset', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderMixed()
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(onConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ usedUpIngredientIds: [], lowIngredientIds: [] }),
      )

      await user.click(within(group('Onion')).getByRole('radio', { name: 'Used up' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(onConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ usedUpIngredientIds: ['onion'] }),
      )
    })

    it('reads the three options in Estonian', async () => {
      renderModal(
        {
          components: [onionComponent],
          householdServings: HAVE_SOME_SERVINGS,
          pantryItems: [onionPantryItem],
        },
        'et',
      )

      const group = await screen.findByRole('radiogroup', { name: 'Mis alles jäi: Onion' })
      expect(
        within(group)
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['Otsas', 'Vähe järel', 'Jäi alles'])
    })
  })

  it('says "cooked" when nothing is deducted', async () => {
    renderModal({ pantryItems: [] })

    const dialog = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(dialog).toHaveTextContent('Mark "Roast chicken" as cooked? Your pantry does not change.')
    expect(dialog).not.toHaveTextContent(/completed/i)
  })
})

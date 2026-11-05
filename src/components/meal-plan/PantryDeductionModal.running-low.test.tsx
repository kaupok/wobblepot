// The real next-intl: the global mock in vitest.setup.ts reads English only, and
// the three choices are asserted in both locales (HON-1522).
import { describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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

import { renderModal } from './PantryDeductionModal.fixtures'

describe('PantryDeductionModal', () => {
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

    // Some left is more than running low (HON-1592): the server clears the mark.
    it('sends a low row switched to "Some left" as some left, so its mark clears', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderMixed({ mince: { low: true }, onion: { low: true } })
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(within(group('Beef mince')).getByRole('radio', { name: 'Some left' }))
      await user.click(within(group('Onion')).getByRole('radio', { name: 'Some left' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      const payload = onConfirm.mock.lastCall![0]
      expect([...payload.someLeftIngredientIds].sort()).toEqual(['mince', 'onion', 'tahini'])
      expect(payload.lowIngredientIds).toEqual([])
    })

    it('keeps a low row left at "Running low" in the low list only', async () => {
      const user = userEvent.setup()
      const { onConfirm } = renderMixed({ mince: { low: true } })
      await screen.findByRole('dialog', { name: 'Mark as cooked' })

      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(onConfirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          someLeftIngredientIds: ['tahini'],
          lowIngredientIds: ['mince'],
        }),
      )
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
})

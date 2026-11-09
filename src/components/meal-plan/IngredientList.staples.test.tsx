import { describe, expect, it, vi } from 'vitest'
// The real next-intl provider, so a removed catalog key cannot come back unseen.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'

import { createIngredient, createMealComponent } from '@/stories/fixtures'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { IngredientList } from './IngredientList'
import type { PantryIngredient } from './types'

// A staple is a row like any other, in the recipe's order (HON-1599), with
// no line of its own under its name (HON-1619).

function component(id: string, name: string) {
  return createMealComponent({
    ingredientId: id,
    quantityPerServing: 10,
    ingredient: createIngredient({ id, name }),
  })
}

// 4 non-staple and 7 staple ingredients, interleaved as a recipe lists them.
const recipe = [
  ['onion', 'Onion', true],
  ['chicken', 'Chicken', false],
  ['garlic', 'Garlic', true],
  ['salt', 'Salt', true],
  ['rice', 'Rice', false],
  ['oil', 'Olive oil', true],
  ['egg', 'Egg', true],
  ['lemon', 'Lemon', false],
  ['pepper', 'Black pepper', true],
  ['yoghurt', 'Greek yoghurt', true],
  ['parsley', 'Parsley', false],
] as const
const components = recipe.map(([id, name]) => component(id, name))
const stapleNames = recipe.filter(([, , staple]) => staple).map(([, name]) => name)
const pantry: PantryIngredient[] = recipe
  .filter(([, , staple]) => staple)
  .map(([id]) => ({ ingredientId: id, isStaple: true }))

function renderInLocale(node: ReactNode, locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

function rows() {
  return within(screen.getByRole('list')).getAllByRole('listitem')
}

function row(name: string) {
  return rows().find((item) => item.textContent?.includes(name))!
}

describe('IngredientList staple rows', () => {
  it('shows every ingredient as a row in recipe order, with no "Staples:" text', () => {
    renderInLocale(
      <IngredientList components={components} servings={2} pantryIngredients={pantry} />,
    )

    expect(rows()).toHaveLength(11)
    expect(rows().map((item) => item.textContent?.replace(/^20g/, ''))).toEqual([
      'Onion',
      'Chicken',
      'Garlic',
      'Salt',
      'Rice',
      'Olive oil',
      'Egg',
      'Lemon',
      'Black pepper',
      'Greek yoghurt',
      'Parsley',
    ])
    expect(screen.queryByText(/Staples:/)).toBeNull()
  })

  it('shows a staple row with only its amount and name, no "Staple" line', () => {
    renderInLocale(
      <IngredientList components={components} servings={2} pantryIngredients={pantry} />,
    )

    expect(screen.queryByText('Staple')).toBeNull()
    for (const name of stapleNames) expect(row(name)).toHaveTextContent(/^20g/)
    expect(row('Olive oil').textContent).toBe('20gOlive oil')
  })

  it('shows no "Põhitoode" line in Estonian', () => {
    renderInLocale(
      <IngredientList components={components} servings={2} pantryIngredients={pantry} />,
      'et',
    )

    expect(screen.queryByText('Põhitoode')).toBeNull()
  })

  it('ticks an in-stock staple and unticks a ran-out one', () => {
    renderInLocale(
      <IngredientList
        components={[component('salt', 'Salt'), component('oil', 'Olive oil')]}
        servings={2}
        pantryIngredients={[
          { ingredientId: 'salt', isStaple: true },
          { ingredientId: 'oil', isStaple: true, ranOut: true },
        ]}
        onToggleAvailability={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Mark Salt as not available' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mark Olive oil as available' })).not.toBeChecked()
  })

  it('tells the toggle which rows are staples', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    renderInLocale(
      <IngredientList
        components={[component('salt', 'Salt'), component('rice', 'Rice')]}
        servings={2}
        pantryIngredients={[
          { ingredientId: 'salt', isStaple: true },
          { ingredientId: 'rice', isStaple: false },
        ]}
        onToggleAvailability={onToggle}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Mark Salt as not available' }))
    await user.click(screen.getByRole('checkbox', { name: 'Mark Rice as not available' }))

    expect(onToggle.mock.calls).toEqual([
      ['salt', false, true],
      ['rice', false, false],
    ])
  })

  it('shows staple rows with no checkbox on a cooked meal', () => {
    renderInLocale(
      <IngredientList
        components={components}
        servings={2}
        pantryIngredients={pantry}
        onToggleAvailability={vi.fn()}
        hideAvailability
      />,
    )

    expect(rows()).toHaveLength(11)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('offers Replace and Leave out on a staple row', async () => {
    const user = userEvent.setup()
    renderInLocale(
      <IngredientList
        components={[component('salt', 'Salt')]}
        servings={2}
        pantryIngredients={[{ ingredientId: 'salt', isStaple: true }]}
        changeControls={{
          onReplace: vi.fn(),
          onLeaveOut: vi.fn(),
          onAdd: vi.fn(),
          onUndo: vi.fn(),
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Change Salt' }))

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Replace', 'Leave out'])
  })

  it('shows the change line on a replacement that is a staple', () => {
    renderInLocale(
      <IngredientList
        components={[component('oil', 'Olive oil')]}
        servings={2}
        pantryIngredients={[{ ingredientId: 'oil', isStaple: true }]}
        changes={[
          {
            id: 'change-1',
            original: { id: 'butter', name: 'Butter' },
            replacement: { id: 'oil', name: 'Olive oil' },
            quantityPerServing: 10,
            stale: false,
          },
        ]}
      />,
    )

    expect(within(row('Olive oil')).getByText('Instead of Butter')).toBeVisible()
    expect(screen.queryByText('Staple')).toBeNull()
  })
})

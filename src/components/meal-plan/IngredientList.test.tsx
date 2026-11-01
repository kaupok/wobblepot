import { describe, expect, it, vi } from 'vitest'
// The real next-intl provider, so the Estonian piece label and decimal comma
// come from the actual catalog (HON-956).
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'

import { createMealComponent } from '@/stories/fixtures'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { IngredientList } from './IngredientList'

const chicken = createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 })
const garlic = createMealComponent({ ingredientId: 'garlic', quantityPerServing: 1 })
const oil = createMealComponent({ ingredientId: 'olive-oil', quantityPerServing: 60 })

function renderInLocale(node: ReactNode, locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

function row(name: string) {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(name))!
}

// The cook view says a weight the way the shopping list does (HON-950).
describe('IngredientList quantities', () => {
  it('renders 1000g and more in kg', () => {
    renderInLocale(<IngredientList components={[chicken]} servings={20} />)
    expect(row('Chicken thigh')).toHaveTextContent('3kg')
  })

  it('renders less than 1000g in grams', () => {
    renderInLocale(<IngredientList components={[chicken]} servings={4} />)
    expect(row('Chicken thigh')).toHaveTextContent('600g')
  })

  it('renders a staple weight in kg', () => {
    renderInLocale(
      <IngredientList
        components={[chicken, oil]}
        servings={20}
        pantryIngredients={[{ ingredientId: 'olive-oil', isStaple: true }]}
      />,
    )
    expect(screen.getByText(/Olive oil \(1\.2l\)/)).toBeInTheDocument()
  })
})

// A liquid shows its stored grams as millilitres, 1:1 (HON-1054).
describe('IngredientList liquid quantities', () => {
  it('renders a measured-by-volume ingredient in ml', () => {
    renderInLocale(<IngredientList components={[oil, chicken]} servings={2} />)
    expect(row('Olive oil')).toHaveTextContent('120ml')
    expect(row('Chicken thigh')).toHaveTextContent('300g')
  })

  it('renders litres with the locale decimal separator', () => {
    renderInLocale(<IngredientList components={[oil]} servings={25} />)
    expect(row('Olive oil')).toHaveTextContent('1.5l')
  })

  it('renders Estonian litres with a decimal comma', () => {
    renderInLocale(<IngredientList components={[oil]} servings={25} />, 'et')
    expect(row('Olive oil')).toHaveTextContent('1,5l')
  })

  it('keeps grams for an ingredient without the flag', () => {
    const paste = createMealComponent({
      ingredientId: 'anchovy-paste',
      quantityPerServing: 10,
      ingredient: {
        id: 'anchovy-paste',
        name: 'Anchovy paste',
        category: 'condiment',
        defaultUnit: 'g',
      },
    })
    renderInLocale(<IngredientList components={[paste]} servings={2} />)
    expect(row('Anchovy paste')).toHaveTextContent('20g')
  })
})

// A piece count carries its unit, on a no-break space so it cannot wrap away
// from the number (HON-956).
describe('IngredientList piece quantities', () => {
  it('labels a whole piece count', () => {
    renderInLocale(<IngredientList components={[garlic]} servings={1} />)
    expect(row('Garlic').textContent).toBe('1 pcGarlic')
  })

  // A half takes the glyph, as the gram-stored hint does, so one list never
  // shows "0.5 pc" next to "½ pc"; any other fraction keeps the locale decimal
  // and no "~", because a stored count is exact (HON-1521).
  it.each([
    [0.5, 1, 'en', '½\u00a0pcLemon'],
    [0.5, 1, 'et', '½\u00a0tkLemon'],
    [0.5, 3, 'en', '1½\u00a0pcLemon'],
    [0.5, 3, 'et', '1½\u00a0tkLemon'],
    [1, 2, 'en', '2\u00a0pcLemon'],
    [1, 2, 'et', '2\u00a0tkLemon'],
    [0.3, 1, 'en', '0.3\u00a0pcLemon'],
    [0.3, 1, 'et', '0,3\u00a0tkLemon'],
  ] as const)(
    'renders %d per serving × %d in %s as %j',
    (quantityPerServing, servings, locale, expected) => {
      const comp = createMealComponent({ ingredientId: 'lemon', quantityPerServing })
      renderInLocale(<IngredientList components={[comp]} servings={servings} />, locale)
      expect(row('Lemon').textContent).toBe(expected)
    },
  )

  it('labels a staple piece count', () => {
    renderInLocale(
      <IngredientList
        components={[chicken, garlic]}
        servings={2}
        pantryIngredients={[{ ingredientId: 'garlic', isStaple: true }]}
      />,
    )
    // `getByText` folds the no-break space into a space; the raw text keeps it.
    expect(screen.getByText(/Garlic \(2 pc\)/).textContent).toContain('Garlic (2 pc)')
  })
})

// A gram-stored vegetable shows as a rounded piece count, with its grams kept
// under the count (HON-1312, HON-1474). Stored grams are per serving, so 83 g
// over 3 servings is 83 / 3.
describe('IngredientList vegetables in pieces', () => {
  function vegetable(
    id: string,
    name: string,
    grams: number,
    gramsPerPiece: number,
    pieceDisplay: 'recipe' | 'recipe_and_shopping',
  ) {
    return createMealComponent({
      ingredientId: id,
      quantityPerServing: grams / 3,
      ingredient: {
        id,
        name,
        category: 'vegetable',
        defaultUnit: 'g',
        gramsPerPiece,
        pieceDisplay,
      },
    })
  }
  const onion = vegetable('onion', 'Onion', 55, 110, 'recipe_and_shopping')

  // The HON-1474 table, with the seed piece weights.
  const TABLE = [
    [500, 'Potato', 150, 'recipe', '~3'],
    [300, 'Potato', 150, 'recipe', '2'],
    [330, 'Potato', 150, 'recipe', '~2'],
    [200, 'Carrot', 60, 'recipe_and_shopping', '~3'],
    [45, 'Carrot', 60, 'recipe_and_shopping', '~1'],
    [300, 'Tomato', 120, 'recipe', '~3'],
    [8, 'Garlic', 5, 'recipe_and_shopping', '~2'],
    [55, 'Onion', 110, 'recipe_and_shopping', '½'],
    [30, 'Onion', 110, 'recipe_and_shopping', '~½'],
    [165, 'Onion', 110, 'recipe_and_shopping', '1½'],
    [190, 'Onion', 110, 'recipe_and_shopping', '~2'],
  ] as const

  it.each([
    ['en', 'pc'],
    ['et', 'tk'],
  ] as const)('shows each table row in %s', (locale, label) => {
    for (const [grams, name, gramsPerPiece, pieceDisplay, count] of TABLE) {
      const component = vegetable(name, name, grams, gramsPerPiece, pieceDisplay)
      const { unmount } = renderInLocale(
        <IngredientList components={[component]} servings={3} />,
        locale,
      )
      expect(row(name).textContent).toBe(`${count}\u00a0${label}${grams}g${name}`)
      unmount()
    }
  })

  it('keeps paprika in grams and oil in ml', () => {
    const paprika = createMealComponent({
      ingredientId: 'paprika',
      quantityPerServing: 2,
      ingredient: { id: 'paprika', name: 'Paprika', category: 'spice', defaultUnit: 'g' },
    })
    const vegetableOil = createMealComponent({
      ingredientId: 'vegetable-oil',
      quantityPerServing: 11 / 3,
      ingredient: {
        id: 'vegetable-oil',
        name: 'Vegetable oil',
        category: 'fat',
        defaultUnit: 'g',
        measuredByVolume: true,
      },
    })
    renderInLocale(<IngredientList components={[paprika, vegetableOil]} servings={3} />)
    expect(row('Paprika').textContent).toBe('6gPaprika')
    expect(row('Vegetable oil').textContent).toBe('11mlVegetable oil')
  })

  it('puts the pieces and the grams in a staple line', () => {
    renderInLocale(
      <IngredientList
        components={[chicken, onion]}
        servings={3}
        pantryIngredients={[{ ingredientId: 'onion', isStaple: true }]}
      />,
    )
    expect(screen.getByText(/Onion \(½ pc, 55g\)/)).toBeInTheDocument()
  })
})

// An editable entry's add action ends the Ingredients heading line, not the
// list (HON-1357). It reads "Add" and is named "Add an ingredient".
describe('IngredientList add button', () => {
  const controls = { onReplace: vi.fn(), onLeaveOut: vi.fn(), onAdd: vi.fn(), onUndo: vi.fn() }

  it('sits on the heading line, after the heading, outside the list', () => {
    renderInLocale(<IngredientList components={[chicken]} servings={2} changeControls={controls} />)
    const button = screen.getByRole('button', { name: 'Add an ingredient' })
    expect(button.textContent).toBe('Add')
    // The heading sits in a baseline group with the status; the line holds
    // that group, then the button.
    const headingLine = screen.getByRole('heading', { name: 'Ingredients' }).parentElement!
      .parentElement!
    expect(button.parentElement).toBe(headingLine)
    expect(headingLine.lastElementChild).toBe(button)
    expect(within(screen.getByRole('list')).queryByRole('button', { name: /^Add/ })).toBeNull()
  })

  it('names the Estonian button "Lisa koostisosa" around the visible "Lisa"', () => {
    renderInLocale(
      <IngredientList components={[chicken]} servings={2} changeControls={controls} />,
      'et',
    )
    expect(screen.getByRole('button', { name: 'Lisa koostisosa' }).textContent).toBe('Lisa')
  })

  it('shows no button without change controls', () => {
    renderInLocale(<IngredientList components={[chicken]} servings={2} />)
    expect(screen.queryByRole('button', { name: 'Add an ingredient' })).toBeNull()
  })
})

// A change reads as a muted line under the name, never a badge beside it
// (HON-1370).
describe('IngredientList changed rows', () => {
  const controls = { onReplace: vi.fn(), onLeaveOut: vi.fn(), onAdd: vi.fn(), onUndo: vi.fn() }
  const rice = createMealComponent({ ingredientId: 'short-grain-rice', quantityPerServing: 80 })
  const added = {
    id: 'change-add',
    original: null,
    replacement: { id: 'short-grain-rice', name: 'Short-grain rice' },
    quantityPerServing: 80,
    stale: false,
  }
  const replaced = {
    id: 'change-replace',
    original: { id: 'lemon', name: 'Lime' },
    replacement: { id: 'chicken-thigh', name: 'Chicken thigh' },
    quantityPerServing: 150,
    stale: false,
  }

  it('says "Added" under an added name, in the muted "Instead of" style, with no badge', () => {
    const { container } = renderInLocale(
      <IngredientList
        components={[chicken, rice]}
        servings={2}
        changes={[added, replaced]}
        changeControls={controls}
      />,
    )
    const label = within(row('Short-grain rice')).getByText('Added')
    expect(label.previousElementSibling?.textContent).toBe('Short-grain rice')
    expect(label.className).toBe(screen.getByText('Instead of Lime').className)
    expect(label.className).toContain('text-muted-foreground')
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    const undo = within(row('Short-grain rice')).getByRole('button', {
      name: 'Undo change: Short-grain rice',
    })
    expect(row('Short-grain rice').lastElementChild).toBe(undo)
  })

  it('says "Lisatud" in Estonian', () => {
    renderInLocale(<IngredientList components={[rice]} servings={2} changes={[added]} />, 'et')
    expect(within(row('Short-grain rice')).getByText('Lisatud')).toBeInTheDocument()
  })

  it('keeps "Added" on a read-only row, with no Undo', () => {
    renderInLocale(<IngredientList components={[rice]} servings={2} changes={[added]} />)
    expect(within(row('Short-grain rice')).getByText('Added')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull()
  })
})

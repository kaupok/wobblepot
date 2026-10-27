import { describe, it, expect, vi } from 'vitest'
// The real next-intl provider, so the Estonian piece label and decimal comma
// come from the actual catalog (HON-956).
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createMealComponent } from '@/stories/fixtures'
import { IngredientList } from './IngredientList'

const chicken = createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 })
const lemon = createMealComponent({ ingredientId: 'lemon', quantityPerServing: 0.5 })
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

  it('leaves piece quantities fractional, with the label', () => {
    renderInLocale(<IngredientList components={[lemon]} servings={3} />)
    expect(row('Lemon').textContent).toBe('1.5 pcLemon')
  })

  it('renders the Estonian label with a decimal comma', () => {
    renderInLocale(<IngredientList components={[lemon]} servings={3} />, 'et')
    expect(row('Lemon').textContent).toBe('1,5 tkLemon')
  })

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

// A gram-stored vegetable shows as quarter pieces, with its grams kept under
// the count (HON-1312). Stored grams are per serving, so 83 g over 3 servings
// is 83 / 3.
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
  const onion = vegetable('onion', 'Onion', 83, 110, 'recipe_and_shopping')
  const cloves = vegetable('garlic-g', 'Garlic', 8, 5, 'recipe_and_shopping')
  const potato = vegetable('potato-g', 'Potato', 450, 150, 'recipe')

  it('shows 83 g onion over 3 servings as ¾ pc with 83g', () => {
    renderInLocale(<IngredientList components={[onion]} servings={3} />)
    expect(row('Onion').textContent).toBe('¾ pc83gOnion')
  })

  it('shows 8 g garlic as 1½ pc', () => {
    renderInLocale(<IngredientList components={[cloves]} servings={3} />)
    expect(row('Garlic').textContent).toBe('1½ pc8gGarlic')
  })

  it('shows 450 g potato as 3 pc', () => {
    renderInLocale(<IngredientList components={[potato]} servings={3} />)
    expect(row('Potato').textContent).toBe('3 pc450gPotato')
  })

  it('shows the Estonian label', () => {
    renderInLocale(<IngredientList components={[onion]} servings={3} />, 'et')
    expect(row('Onion').textContent).toBe('¾ tk83gOnion')
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
    expect(screen.getByText(/Onion \(¾ pc, 83g\)/)).toBeInTheDocument()
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

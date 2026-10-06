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

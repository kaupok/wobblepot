import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createMealComponent } from '@/stories/fixtures'
import { IngredientList } from './IngredientList'

const chicken = createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 })
const lemon = createMealComponent({ ingredientId: 'lemon', quantityPerServing: 0.5 })
const oil = createMealComponent({ ingredientId: 'olive-oil', quantityPerServing: 60 })

function row(name: string) {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(name))!
}

// The cook view says a weight the way the shopping list does (HON-950).
describe('IngredientList quantities', () => {
  it('renders 1000g and more in kg', () => {
    render(<IngredientList components={[chicken]} servings={20} />)
    expect(row('Chicken thigh')).toHaveTextContent('3kg')
  })

  it('renders less than 1000g in grams', () => {
    render(<IngredientList components={[chicken]} servings={4} />)
    expect(row('Chicken thigh')).toHaveTextContent('600g')
  })

  it('leaves piece quantities fractional', () => {
    render(<IngredientList components={[lemon]} servings={3} />)
    expect(row('Lemon')).toHaveTextContent(/^1\.5Lemon$/)
  })

  it('renders a staple weight in kg', () => {
    render(
      <IngredientList
        components={[chicken, oil]}
        servings={20}
        pantryIngredients={[{ ingredientId: 'olive-oil', isStaple: true }]}
      />,
    )
    expect(screen.getByText(/Olive oil \(1\.2kg\)/)).toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { SampleDay } from '@/lib/meal-plans/build-sample-week'
import { SampleMealCard } from './SampleMealCard'

vi.mock('@/components/meal-plan/MealImage', () => ({ MealImage: () => null }))

const day: SampleDay = {
  dayName: 'Wednesday',
  anchor: 'wednesday',
  meal: {
    id: 'm-1',
    name: 'Fish and Chips',
    description: 'Battered cod with chips',
    kidFriendly: true,
    timeMinutes: 40,
    primaryProteinType: 'fish',
    imageUrl: null,
    imageStatus: 'none',
    imageHue: null,
  },
  ingredients: [
    { id: 'cod', name: 'cod fillet', quantity: '450g', isVague: false },
    { id: 'salt', name: 'salt', quantity: 'to taste', isVague: true },
  ],
}

describe('SampleMealCard', () => {
  it('shows the day, the meal and its facts', () => {
    render(<SampleMealCard day={day} />)
    expect(screen.getByText('Wednesday')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Fish and Chips' })).toBeInTheDocument()
    expect(screen.getByText('Battered cod with chips')).toBeInTheDocument()
    expect(screen.getByText('Fish')).toBeInTheDocument()
    expect(screen.getByText('40 min')).toBeInTheDocument()
  })

  it('lists the ingredients with their quantities, quantity first', () => {
    render(<SampleMealCard day={day} />)
    const list = screen.getByRole('list', { name: 'Ingredients: Fish and Chips' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['450gcod fillet', 'to tastesalt'])
  })

  it('carries the day as its anchor, for the structured data’s link', () => {
    const { container } = render(<SampleMealCard day={day} />)
    expect(container.querySelector('#wednesday')).not.toBeNull()
  })

  it('is a picture, not a control: nothing on it opens', () => {
    render(<SampleMealCard day={day} />)
    expect(screen.queryByRole('button', { name: 'Fish and Chips' })).toBeNull()
  })

  it('leaves out the time and description a meal does not have', () => {
    render(
      <SampleMealCard
        day={{
          ...day,
          meal: { ...day.meal, timeMinutes: null, description: null, kidFriendly: false },
        }}
      />,
    )
    expect(screen.queryByText('40 min')).toBeNull()
    expect(screen.queryByText('Battered cod with chips')).toBeNull()
  })
})

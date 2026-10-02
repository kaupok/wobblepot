import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createMeal } from '@/stories/fixtures'
import type { DemoDay } from '@/lib/landing/load-demo-day'
import { LandingDemo } from './LandingDemo'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('@/components/meal-plan/MealImage', () => ({ MealImage: () => null }))

const day: DemoDay = {
  date: '2026-10-02',
  meals: [
    {
      mealType: 'breakfast',
      servings: 4,
      steps: { steps: ['Toast the bread', 'Poach the eggs'], pitfalls: ['Old bread goes soggy'] },
      meal: createMeal({ id: 'm-1', name: 'Avocado toast', primaryProteinType: 'eggs' }),
    },
    {
      mealType: 'lunch',
      servings: 4,
      steps: { steps: ['Cook the rice'], pitfalls: [] },
      meal: createMeal({ id: 'm-2', name: 'Beef bibimbap', primaryProteinType: 'beef' }),
    },
    {
      mealType: 'dinner',
      servings: 4,
      steps: { steps: ['Roast the salmon'], pitfalls: [] },
      meal: createMeal({ id: 'm-3', name: 'Baked salmon', primaryProteinType: 'fish' }),
    },
  ],
}

function renderDemo() {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { wrapper } = createQueryWrapper()
  render(<LandingDemo day={day} dayLabel="Thursday" />, { wrapper })
  return { fetchMock }
}

describe('LandingDemo', () => {
  it('draws the day with one card per slot, each name a button', () => {
    renderDemo()
    expect(screen.getByText('Thursday')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avocado toast' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beef bibimbap' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Baked salmon' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the cook view read-only, with the steps and nothing that writes', async () => {
    const user = userEvent.setup()
    const { fetchMock } = renderDemo()

    await user.click(screen.getByRole('button', { name: 'Avocado toast' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Avocado toast' })).toBeInTheDocument()
    expect(within(dialog).getByText('Poach the eggs')).toBeInTheDocument()
    expect(within(dialog).getByText('Old bread goes soggy')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /done cooking/i })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /ask about step/i })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /more actions/i })).toBeNull()
    expect(within(dialog).queryByRole('spinbutton')).toBeNull()
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the meal that was tapped, with its own steps', async () => {
    const user = userEvent.setup()
    renderDemo()

    await user.click(screen.getByRole('button', { name: 'Baked salmon' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Baked salmon' })).toBeInTheDocument()
    expect(within(dialog).getByText('Roast the salmon')).toBeInTheDocument()
    expect(within(dialog).queryByText('Toast the bread')).toBeNull()
  })
})

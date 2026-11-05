// The real next-intl: the side line is checked per locale (HON-1610).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { type ExternalToast, toast } from 'sonner'

import { createMeal, createMealComponent, createPantryItem } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { MealCard } from './MealCard'
import type { PlanEntrySide } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

// Chicken thigh at 150 g a serving, among others.
const meal = createMeal()

function side(overrides: Partial<PlanEntrySide> = {}): PlanEntrySide {
  return {
    entryId: 'side-salad',
    mealId: 'meal-salad',
    mealName: 'Cucumber salad',
    servings: 3,
    cookServings: 3,
    status: 'planned',
    rating: null,
    servingOverride: null,
    pantryDeducted: false,
    // Chicken in a salad, so the side shares the main's ingredient.
    components: [createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 100 })],
    ...overrides,
  }
}

const SIDES = [
  side(),
  side({ entryId: 'side-slaw', mealId: 'meal-slaw', mealName: 'Cabbage slaw', servings: 2 }),
]

let requests: { method: string; url: string; body: unknown }[]

beforeEach(() => {
  requests = []
  vi.mocked(toast).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'entry-2', success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(
  locale: 'en' | 'et' = 'en',
  props: Partial<Parameters<typeof MealCard>[0]> = {},
) {
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      <Wrapper>
        <MealCard
          entryId="entry-1"
          planId="plan-1"
          date="2026-10-12"
          meal={meal}
          mealType="dinner"
          status="planned"
          householdServings={3}
          cookServings={3}
          pantryItems={[
            createPantryItem({ ingredientId: 'chicken-thigh', quantity: 1000, isStaple: false }),
          ]}
          sides={SIDES}
          {...props}
        />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

describe('MealCard with side dishes (HON-1610)', () => {
  it('shows one line per side under the name', () => {
    renderCard()
    expect(screen.getByText('+ Cucumber salad · 3')).toBeInTheDocument()
    expect(screen.getByText('+ Cabbage slaw · 2')).toBeInTheDocument()
  })

  it('shows the lines in Estonian', () => {
    renderCard('et')
    expect(screen.getByText('+ Cucumber salad · 3')).toBeInTheDocument()
    expect(screen.getByText('+ Cabbage slaw · 2')).toBeInTheDocument()
  })

  it('previews one summed row and completes the slot with one request', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Cooked' }))
    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    // 150 g × 3 for the main, 100 g × 3 and × 3 cook servings for the sides: 1050 g.
    expect(within(deduction).getAllByText('Chicken thigh')).toHaveLength(1)
    expect(within(deduction).getByText('Chicken thigh').nextElementSibling).toHaveTextContent(
      '1000g → Ran out',
    )
    await user.click(within(deduction).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(requests.filter((r) => r.method === 'PATCH')).toHaveLength(1))
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        url: '/api/meal-plans/plan-1/entries/entry-1',
      }),
    ])
  })

  it('previews only the new side when the main was charged before', async () => {
    const user = userEvent.setup()
    renderCard('en', { pantryDeducted: true, sides: [SIDES[0]!] })

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Cooked' }))
    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    // The salad's 100 g × 3; the main's chicken was charged already.
    expect(within(deduction).getByText('Chicken thigh').nextElementSibling).toHaveTextContent(
      '1000g → 700g',
    )
  })

  it('posts the sides back with the main on Undo after Clear', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Clear' }))
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    const options = vi.mocked(toast).mock.calls[0]![1] as ExternalToast
    const action = options.action as { onClick: (event: unknown) => void }
    action.onClick({})

    await waitFor(() =>
      expect(requests.find((r) => r.method === 'POST')?.body).toMatchObject({
        mealId: meal.id,
        restore: true,
        sides: [
          {
            mealId: 'meal-salad',
            servingOverride: null,
            status: 'planned',
            rating: null,
            pantryDeducted: false,
          },
          {
            mealId: 'meal-slaw',
            servingOverride: null,
            status: 'planned',
            rating: null,
            pantryDeducted: false,
          },
        ],
      }),
    )
  })
})

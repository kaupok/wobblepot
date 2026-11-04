// The real next-intl: the global mock in vitest.setup.ts reads English only and
// has no ICU `select`, and these copy lines are per locale (HON-1395).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import { createMeal, lemonGarlicChickenPantryItems } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { MealCard } from './MealCard'
import { MealDetail } from './MealDetail'
import type { LeftoverLunch } from './types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// Chicken thigh at 150 g a serving, among others.
const meal = createMeal()
// 2026-10-13 is a Tuesday.
const tuesdayLunch: LeftoverLunch = { date: '2026-10-13', mealType: 'lunch', servings: 2.5 }

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderCard(
  props: Partial<Parameters<typeof MealCard>[0]> = {},
  locale: 'en' | 'et' = 'en',
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
          cookServings={5.5}
          leftoversFor={[tuesdayLunch]}
          {...props}
        />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

describe('MealCard with a leftover lunch (HON-1395)', () => {
  it('shows the total and the lunch part', () => {
    renderCard()
    expect(screen.getByText('5.5 servings · leftovers for Tuesday')).toBeInTheDocument()
  })

  it('shows them in Estonian, with a decimal comma and the day declined', () => {
    renderCard({}, 'et')
    expect(screen.getByText('5,5 portsjonit · jäägid teisipäevaks')).toBeInTheDocument()
  })

  it("declines Sunday, the message's other branch, in Estonian", () => {
    renderCard({ leftoversFor: [{ ...tuesdayLunch, date: '2026-10-18' }] }, 'et')
    expect(screen.getByText('5,5 portsjonit · jäägid pühapäevaks')).toBeInTheDocument()
  })

  it('joins two days with a separator', () => {
    renderCard({
      cookServings: 7.5,
      leftoversFor: [tuesdayLunch, { date: '2026-10-14', mealType: 'lunch', servings: 2 }],
    })
    expect(
      screen.getByText('7.5 servings · leftovers for Tuesday · leftovers for Wednesday'),
    ).toBeInTheDocument()
  })

  it('names a day once when two meals on it take leftovers', () => {
    renderCard({
      cookServings: 7.5,
      leftoversFor: [tuesdayLunch, { ...tuesdayLunch, mealType: 'dinner', servings: 2 }],
    })
    expect(screen.getByText('7.5 servings · leftovers for Tuesday')).toBeInTheDocument()
  })

  it('shows no servings badge with no leftover lunch and no override, as before', () => {
    renderCard({ cookServings: 3, leftoversFor: [] })
    expect(screen.queryByText(/servings/)).not.toBeInTheDocument()
  })

  it('ignores a leftover added in the picker, which carries no servings', () => {
    renderCard({ cookServings: 3, leftoversFor: [{ ...tuesdayLunch, servings: null }] })
    expect(screen.queryByText(/servings/)).not.toBeInTheDocument()
  })

  it('shows the stored count of a completed dinner', () => {
    renderCard({ status: 'completed', cookServings: 6 })
    expect(screen.getByText('6 servings · leftovers for Tuesday')).toBeInTheDocument()
  })

  it('shows no lunch part on a skipped dinner, which cooks nothing', () => {
    renderCard({ status: 'skipped', cookServings: 5.5 })
    expect(screen.queryByText(/for lunch/)).not.toBeInTheDocument()
  })

  it('previews the pantry charge for the total, as the server charges it', async () => {
    const user = userEvent.setup()
    // 800 g of chicken thigh: 3 servings use 450 g, 5.5 use 825 g.
    renderCard({ pantryItems: lemonGarlicChickenPantryItems })
    await user.click(screen.getByRole('button', { name: `More actions: ${meal.name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Cooked' }))
    const deduction = await screen.findByRole('dialog', { name: 'Mark as cooked' })
    expect(within(deduction).getByText('Chicken thigh').nextElementSibling).toHaveTextContent(
      '800g → Ran out',
    )
  })

  it('adds a changed own servings to the lunch at once', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: meal.name }))
    const dialog = await screen.findByRole('dialog')
    // The control edits the dinner's own servings, not the total.
    await user.click(within(dialog).getByRole('button', { name: 'Serves 3. Click to edit.' }))
    const field = within(dialog).getByRole('textbox', { name: 'Number of servings' })
    await user.clear(field)
    await user.type(field, '4{Enter}')
    expect(
      await within(dialog).findByRole('button', { name: 'Serves 4. Click to edit.' }),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(await screen.findByText('6.5 servings · leftovers for Tuesday')).toBeInTheDocument()
  })
})

describe('MealDetail with a leftover lunch (HON-1395, HON-1600)', () => {
  function renderDetail(
    props: Partial<Parameters<typeof MealDetail>[0]> = {},
    locale: 'en' | 'et' = 'en',
  ) {
    const onServingsChange = vi.fn(async () => true)
    render(
      <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
        <MealDetail
          meal={meal}
          householdServings={3}
          servings={3}
          leftovers={[{ ...tuesdayLunch, servings: 2.5 }]}
          onServingsChange={onServingsChange}
          {...props}
        />
      </NextIntlClientProvider>,
    )
    return { onServingsChange }
  }

  function chickenRow() {
    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    return rows.find((row) => row.textContent?.includes('Chicken thigh'))
  }

  it('scales the amounts by the total, and names the leftover share after the own servings', () => {
    renderDetail()
    expect(chickenRow()).toHaveTextContent('825g') // 150 g × 5.5
    const badges = screen.getByTestId('cook-view-badges')
    const control = within(badges).getByRole('button', { name: 'Serves 3. Click to edit.' })
    const share = within(badges).getByText('+ 2.5 for Tuesday')
    expect(control).not.toContainElement(share)
    expect(screen.queryByText(/Ingredients for/)).not.toBeInTheDocument()
  })

  it('opens no servings field on a tap on the leftover share', async () => {
    const user = userEvent.setup()
    renderDetail()
    await user.click(screen.getByText('+ 2.5 for Tuesday'))
    expect(screen.queryByRole('textbox', { name: 'Number of servings' })).not.toBeInTheDocument()
  })

  it('names each leftover lunch in date order', () => {
    renderDetail({
      leftovers: [
        { ...tuesdayLunch, servings: 2.5 },
        { date: '2026-10-16', mealType: 'lunch', servings: 2 },
      ],
    })
    expect(chickenRow()).toHaveTextContent('1.1kg') // 150 g × 7.5
    expect(screen.getByTestId('cook-view-badges')).toHaveTextContent(
      /Serves 3.*\+ 2\.5 for Tuesday\+ 2 for Friday$/,
    )
  })

  it('declines the weekday and writes a decimal comma in Estonian', () => {
    renderDetail({ leftovers: [{ date: '2026-10-16', mealType: 'lunch', servings: 1.5 }] }, 'et')
    expect(screen.getByText('+ 1,5 reedeks')).toBeInTheDocument()
  })

  it('shows a completed entry its own servings, read-only, then the leftover share', () => {
    renderDetail({ status: 'completed', cookedServings: 6 })
    expect(chickenRow()).toHaveTextContent('900g') // 150 g × 6
    expect(screen.queryByRole('button', { name: /^Serves/ })).not.toBeInTheDocument()
    expect(screen.getByText('Serves 3')).toBeInTheDocument()
    expect(screen.getByText('+ 2.5 for Tuesday')).toBeInTheDocument()
  })

  it('shows a completed entry with no leftover lunch its cooked total', () => {
    renderDetail({ status: 'completed', cookedServings: 4, leftovers: [] })
    expect(screen.getByText('Serves 4')).toBeInTheDocument()
  })

  it('shows no leftover share without a leftover lunch', () => {
    renderDetail({ leftovers: [] })
    expect(chickenRow()).toHaveTextContent('450g') // 150 g × 3
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })
})

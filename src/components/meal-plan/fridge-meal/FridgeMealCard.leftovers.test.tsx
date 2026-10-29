// The real next-intl: the global mock in vitest.setup.ts reads English only and
// has no ICU `select`, and the leftover line names its slot per locale (HON-1395).
import { describe, expect, it, vi } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import {
  fridgeItems,
  fridgePantryItems,
  plannedLeftoverItem,
  skippedLeftoverItem,
} from '@/stories/fridge-fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import type { FridgeMealItem } from '../types'
import { FridgeMealCard } from './FridgeMealCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

const WARNING =
  "These leftovers won't exist, because that meal is skipped or changed. Plan something else for this meal."

function renderCard(
  items: FridgeMealItem[],
  {
    status = 'planned',
    locale = 'en',
  }: { status?: 'planned' | 'completed'; locale?: 'en' | 'et' } = {},
) {
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      <Wrapper>
        <FridgeMealCard
          entryId="entry-1"
          planId="plan-1"
          date="2026-10-21"
          mealType="lunch"
          status={status}
          items={items}
          pantryItems={fridgePantryItems}
        />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

describe('FridgeMealCard leftover from a planned dinner (HON-1395)', () => {
  it('names the dinner, and under it its day and slot, its servings, and "planned"', () => {
    renderCard([plannedLeftoverItem])
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/^Roast chicken$/)
    expect(screen.getByText('Tuesday at dinner · 2.5 servings · planned')).toBeInTheDocument()
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('says it in Estonian, with a decimal comma', () => {
    renderCard([plannedLeftoverItem], { locale: 'et' })
    expect(
      screen.getByText('Teisipäev, õhtusöök · 2,5 portsjonit · planeeritud'),
    ).toBeInTheDocument()
  })

  it('drops "planned" once the dinner is cooked', () => {
    renderCard([{ ...plannedLeftoverItem, sourceState: 'completed' }])
    expect(screen.getByText('Tuesday at dinner · 2.5 servings')).toBeInTheDocument()
  })

  it('warns that the leftovers will not exist when the dinner is skipped', () => {
    renderCard([skippedLeftoverItem])
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    expect(screen.queryByText(/planned/)).not.toBeInTheDocument()
  })

  it('drops the warning once the lunch is eaten', () => {
    renderCard([skippedLeftoverItem], { status: 'completed' })
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  // A leftover picked in the dialog takes no servings, so it has no line.
  it('shows no source line for a leftover added in the picker', () => {
    renderCard(fridgeItems)
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(/^Mash$/)
    expect(screen.queryByText(/servings/)).not.toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from 'vitest'
// The real provider, so the Estonian catalog and its plurals render (HON-1389).
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createHouseholdMealListData } from '@/stories/fixtures'
import { RecipeCard } from './RecipeCard'

const TODAY = '2026-10-28'

function renderCard(
  history: { lastCookedOn: string | null; nextPlannedOn?: string | null },
  locale: 'en' | 'et' = 'en',
) {
  const meal = createHouseholdMealListData({
    name: 'Chicken soup',
    nextPlannedOn: null,
    ...history,
  })
  const { wrapper: QueryWrapper } = createQueryWrapper()
  render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
        <RecipeCard meal={meal} titleActions={null} onOpen={() => {}} today={TODAY} />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

describe('RecipeCard cook history (HON-1389)', () => {
  it('says how long ago the household cooked the recipe', () => {
    renderCard({ lastCookedOn: '2026-10-16' })

    expect(screen.getByText('Cooked 12 days ago')).toBeInTheDocument()
  })

  it('says it in Estonian for an Estonian household', () => {
    renderCard({ lastCookedOn: '2026-10-16' }, 'et')

    expect(screen.getByText('Tehtud 12 päeva tagasi')).toBeInTheDocument()
  })

  it('says a recipe never cooked is not cooked yet, and when it is planned', () => {
    renderCard({ lastCookedOn: null, nextPlannedOn: '2026-10-31' })

    expect(screen.getByText('Not cooked yet · Planned: Sat, Oct 31')).toBeInTheDocument()
  })
})

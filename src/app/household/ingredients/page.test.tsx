import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  HOUSEHOLD_INGREDIENTS_QUERY_KEY,
  type HouseholdIngredientsResponse,
} from '@/components/household/household-ingredients-query'
import { accountSession as session, membershipWithMemberCount } from '@/test/account-page'
import { createQueryWrapper } from '@/test/query-wrapper'

import HouseholdLayout from '../layout'
import HouseholdIngredientsPage, { generateMetadata } from './page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/household', () => ({
  getHouseholdMembership: vi.fn(),
}))

vi.mock('@/lib/ingredients/manage', () => ({
  listHouseholdIngredients: vi.fn(),
}))

// Under jsdom `getQueryClient` would hand back its browser singleton, so the
// cache would leak between tests.
vi.mock('@/lib/get-query-client', () => ({
  getQueryClient: vi.fn(() => new QueryClient()),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('../HouseholdTabs', () => ({
  HouseholdTabs: () => <nav aria-label="Household sections" />,
}))

// The stub reads what the page dehydrated, under the key the real list
// queries, so a passing test means the list skips its first fetch.
vi.mock('@/components/household/HouseholdIngredientList', () => ({
  HouseholdIngredientList: function HouseholdIngredientListStub() {
    const data = useQueryClient().getQueryData<HouseholdIngredientsResponse>(
      HOUSEHOLD_INGREDIENTS_QUERY_KEY,
    )
    return (
      <ul data-testid="ingredient-list">
        {data?.ingredients.map((ingredient) => <li key={ingredient.id}>{ingredient.name}</li>) ?? (
          <li>no prefetched ingredients</li>
        )}
      </ul>
    )
  },
}))

async function mockSignedIn(role: 'owner' | 'member' = 'owner') {
  const { getSession } = await import('@/lib/session')
  const { getHouseholdMembership } = await import('@/lib/household')
  const { listHouseholdIngredients } = await import('@/lib/ingredients/manage')
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(getHouseholdMembership).mockResolvedValue(membershipWithMemberCount(2, role) as never)
  vi.mocked(listHouseholdIngredients).mockResolvedValue([{ id: 'ing-1', name: 'lovage' }] as never)
}

async function renderPage() {
  const { wrapper } = createQueryWrapper()
  render(await HouseholdLayout({ children: await HouseholdIngredientsPage() }), { wrapper })
}

describe('HouseholdIngredientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Ingredients · Household' })
  })

  it("prefetches the household's ingredients so the list needs no client fetch", async () => {
    await mockSignedIn()
    const { listHouseholdIngredients } = await import('@/lib/ingredients/manage')

    await renderPage()

    expect(listHouseholdIngredients).toHaveBeenCalledWith('household-123')
    expect(screen.getByTestId('ingredient-list')).toHaveTextContent('lovage')
  })

  it('shows the list to a member who is not the owner', async () => {
    await mockSignedIn('member')

    await renderPage()

    expect(screen.getByTestId('ingredient-list')).toHaveTextContent('lovage')
  })

  it('still renders when the prefetch fails, leaving the fetch to the client', async () => {
    await mockSignedIn()
    const { listHouseholdIngredients } = await import('@/lib/ingredients/manage')
    vi.mocked(listHouseholdIngredients).mockRejectedValue(new Error('db down'))

    await renderPage()

    expect(screen.getByText('no prefetched ingredients')).toBeInTheDocument()
  })

  it('redirects to sign-in without a session', async () => {
    const { getSession } = await import('@/lib/session')
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(HouseholdIngredientsPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in')
  })

  it('redirects home without a household', async () => {
    const { getSession } = await import('@/lib/session')
    const { getHouseholdMembership } = await import('@/lib/household')
    vi.mocked(getSession).mockResolvedValue(session as never)
    vi.mocked(getHouseholdMembership).mockResolvedValue(null)

    await expect(HouseholdIngredientsPage()).rejects.toThrow('NEXT_REDIRECT:/')
  })
})

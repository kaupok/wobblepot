import { afterEach, describe, expect, it, vi } from 'vitest'

import { setCatalogLocale } from '@/test/catalog-translator'

import { generateMetadata } from './page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/catalog-translator')).catalogTranslator),
}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/household', () => ({ getHouseholdMembership: vi.fn() }))
vi.mock('./EditRecipeClient', () => ({ EditRecipeClient: () => null }))

describe('EditRecipePage generateMetadata', () => {
  afterEach(() => setCatalogLocale('en'))

  it.each([
    ['en', 'Edit recipe'],
    ['et', 'Muuda retsepti'],
  ] as const)('names the tab for a %s household', async (locale, title) => {
    setCatalogLocale(locale)
    expect(await generateMetadata()).toEqual({ title })
  })
})

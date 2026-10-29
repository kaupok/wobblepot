import { afterEach, describe, expect, it, vi } from 'vitest'

import { setCatalogLocale } from '@/test/catalog-translator'

import { generateMetadata } from './page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/catalog-translator')).catalogTranslator),
}))
vi.mock('@/components/inventory/InventoryPage', () => ({ InventoryPage: () => null }))
vi.mock('./load-inventory', () => ({ loadInventory: vi.fn() }))

describe('ShoppingPage generateMetadata', () => {
  afterEach(() => setCatalogLocale('en'))

  it.each([
    ['en', 'Shopping list'],
    ['et', 'Poenimekiri'],
  ] as const)('names the tab for a %s household', async (locale, title) => {
    setCatalogLocale(locale)
    expect(await generateMetadata()).toEqual({ title })
  })
})

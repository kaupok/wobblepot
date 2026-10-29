import { getTranslations } from 'next-intl/server'
import { describe, expect, it, vi } from 'vitest'

import etMessages from '../../../messages/et.json'
import { generateMetadata } from './page'

vi.mock('next-intl/server', async () => ({
  getTranslations: vi.fn((await import('@/test/account-page')).catalogTranslations),
}))

const etCatalog = etMessages as unknown as Record<string, Record<string, string>>

describe('My recipes page metadata', () => {
  it('names its tab in the document title', async () => {
    expect(await generateMetadata()).toEqual({ title: 'My recipes' })
  })

  // The household's locale picks the catalog; the tab follows it.
  it('names its tab in Estonian for an Estonian household', async () => {
    vi.mocked(getTranslations).mockImplementationOnce(
      (async (namespace: string) => (key: string) => etCatalog[namespace]?.[key]) as never,
    )

    expect(await generateMetadata()).toEqual({ title: 'Minu retseptid' })
  })
})

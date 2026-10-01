import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createTranslator, type Messages } from 'next-intl'
import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'
import type { Locale } from '@/lib/i18n/locales'
import manifest from './manifest'

const { localeRef } = vi.hoisted(() => ({ localeRef: { current: 'en' as Locale } }))

const CATALOGS: Record<Locale, Messages> = { en: enMessages, et: etMessages }

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) =>
    createTranslator({
      locale: localeRef.current,
      messages: CATALOGS[localeRef.current],
      namespace: namespace as never,
    }),
  ),
}))

describe('manifest', () => {
  beforeEach(() => {
    localeRef.current = 'en'
  })

  it('describes the app in English for an en request', async () => {
    const result = await manifest()

    expect(result.name).toBe('Wobblepot')
    expect(result.description).toBe('AI-powered weekly meal planning for families')
  })

  it('describes the app in Estonian for an et request', async () => {
    localeRef.current = 'et'

    const result = await manifest()

    expect(result.description).toBe('Tehisintellekti abil loodud nädalased söögiplaanid peredele')
  })
})

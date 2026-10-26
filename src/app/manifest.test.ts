import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createTranslator, type Messages } from 'next-intl'
import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'
import type { Locale } from '@/lib/i18n/locales'
import manifest from './manifest'

const { localeRef, env } = vi.hoisted(() => ({
  localeRef: { current: 'en' as Locale },
  env: { NEXT_PUBLIC_APP_ENV: 'production' },
}))

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

vi.mock('@/lib/env', () => ({ clientEnv: env }))

describe('manifest', () => {
  beforeEach(() => {
    localeRef.current = 'en'
    env.NEXT_PUBLIC_APP_ENV = 'production'
  })

  it('describes the app in English for an en request', async () => {
    const result = await manifest()

    expect(result.name).toBe('Wobblepot')
    expect(result.description).toBe(
      "Dinner, decided, for the whole week. Wobblepot plans your family's meals around who's eating, what they avoid and what's in the pantry.",
    )
  })

  it('describes the app in Estonian for an et request', async () => {
    localeRef.current = 'et'

    const result = await manifest()

    expect(result.description).toBe(
      'Õhtusöök otsustatud, terveks nädalaks. Wobblepot koostab pere söögiplaani selle järgi, kes sööb, mida välditakse ja mis on sahvris.',
    )
  })

  it('installs the production icons in production', async () => {
    const result = await manifest()

    expect(result.icons?.map((icon) => icon.src)).toEqual([
      '/icons/icon-192x192.png',
      '/icons/icon-512x512.png',
      '/icons/icon-maskable-192x192.png',
      '/icons/icon-maskable-512x512.png',
    ])
  })

  // HON-1320: an installed staging PWA shows the yellow dot too. The maskable
  // pair stays production, because the platform crops a corner dot.
  it('installs the dotted icons on staging', async () => {
    env.NEXT_PUBLIC_APP_ENV = 'staging'

    const result = await manifest()

    expect(result.icons?.map((icon) => icon.src)).toEqual([
      '/icons/staging/icon-192x192.png',
      '/icons/staging/icon-512x512.png',
      '/icons/icon-maskable-192x192.png',
      '/icons/icon-maskable-512x512.png',
    ])
  })
})

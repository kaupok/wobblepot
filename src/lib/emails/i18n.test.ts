import { describe, it, expect, vi } from 'vitest'
import { emailTranslator } from './i18n'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'

describe('emailTranslator', () => {
  it('resolves copy from the requested locale', () => {
    const en = emailTranslator('en', 'resetPassword')
    const et = emailTranslator('et', 'resetPassword')

    expect(en('cta')).toBe(enMessages.emails.resetPassword.cta)
    expect(et('cta')).toBe(etMessages.emails.resetPassword.cta)
    expect(et('cta')).not.toBe(en('cta'))
  })

  it('interpolates ICU arguments', () => {
    const t = emailTranslator('et', 'resetPassword')

    expect(t('intro', { appName: 'Wobblepot' })).toContain('Wobblepot')
  })

  it('never renders a bare key path for any email key in any locale', () => {
    // The failure this guards: next-intl's default fallback for a missing
    // message is the literal key path, which would land in a CTA button as
    // `emails.resetPassword.cta`. See the English overlay in `./i18n.ts`.
    const namespaces = ['resetPassword', 'accountDeletionRequested'] as const

    for (const locale of ['en', 'et'] as const) {
      for (const namespace of namespaces) {
        const t = emailTranslator(locale, namespace)
        const keys = Object.keys(enMessages.emails[namespace])

        for (const key of keys) {
          // Every argument every email message can take; extras are ignored.
          const rendered = t.markup(key, {
            appName: 'Wobblepot',
            date: '5 July 2026',
            email: 'privacy@wobblepot.com',
            strong: (chunks) => chunks,
            link: (chunks) => chunks,
          })

          expect(rendered, `${locale}.${namespace}.${key}`).not.toContain(
            `emails.${namespace}.${key}`,
          )
          expect(rendered.trim(), `${locale}.${namespace}.${key}`).not.toBe('')
        }
      }
    }
  })

  it('falls back to English for a key a locale catalog is missing', async () => {
    // Stub an `et` catalog with one key removed, then re-import the module so
    // the overlay is rebuilt against it.
    const stripped = structuredClone(etMessages)
    delete (stripped.emails.resetPassword as Partial<Record<string, string>>).cta

    vi.resetModules()
    vi.doMock('../../../messages/et.json', () => ({ default: stripped }))

    const { emailTranslator: translatorWithGap } = await import('./i18n')
    const t = translatorWithGap('et', 'resetPassword')

    expect(t('cta')).toBe(enMessages.emails.resetPassword.cta)
    // Keys the stub still defines stay Estonian.
    expect(t('heading')).toBe(etMessages.emails.resetPassword.heading)

    vi.doUnmock('../../../messages/et.json')
    vi.resetModules()
  })
})

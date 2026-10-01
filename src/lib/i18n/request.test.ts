import { describe, it, expect, vi, beforeEach } from 'vitest'
import requestConfig from './request'
import { getLocale } from './get-locale'

vi.mock('next-intl/server', () => ({
  // The real `getRequestConfig` returns its callback unchanged.
  getRequestConfig: (fn: unknown) => fn,
}))

vi.mock('./get-locale', () => ({
  getLocale: vi.fn(async () => 'en'),
}))

const requestLocale = Promise.resolve(undefined)

describe('i18n request config', () => {
  beforeEach(() => {
    vi.mocked(getLocale).mockClear()
  })

  it("honours an explicit locale with that locale's messages, without resolving the request", async () => {
    // `getTranslations({ locale: 'et', namespace })` from a route whose request
    // would resolve to English (HON-921).
    const config = await requestConfig({ locale: 'et', requestLocale })

    expect(config.locale).toBe('et')
    expect((config.messages as { dates: { today: string } }).dates.today).toBe('Täna')
    expect(getLocale).not.toHaveBeenCalled()
  })

  it('resolves the request locale when no override is given', async () => {
    vi.mocked(getLocale).mockResolvedValueOnce('et')

    const config = await requestConfig({ requestLocale })

    expect(config.locale).toBe('et')
    expect(getLocale).toHaveBeenCalledOnce()
  })

  it('ignores an override outside KNOWN_LOCALES', async () => {
    const config = await requestConfig({ locale: 'xx', requestLocale })

    expect(config.locale).toBe('en')
    expect(getLocale).toHaveBeenCalledOnce()
  })
})

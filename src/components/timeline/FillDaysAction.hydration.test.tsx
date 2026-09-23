import { describe, it, expect, vi, afterEach } from 'vitest'
// `useLocale()` requires the real next-intl context; the global mock only
// stubs `useTranslations`.
vi.unmock('next-intl')
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { FillDaysAction } from './FillDaysAction'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

const { wrapper: Wrapper } = createQueryWrapper()

function tree(locale: 'en' | 'et') {
  return (
    <Wrapper>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === 'et' ? etMessages : enMessages}
        timeZone="Europe/Tallinn"
      >
        <FillDaysAction planId="plan-1" startDate="2026-09-26" />
      </NextIntlClientProvider>
    </Wrapper>
  )
}

/**
 * Make `formatRange` behave the way it does in Chrome, which swaps ICU's
 * U+2009 thin spaces around the range dash for plain spaces. Node — the
 * server — keeps them.
 */
function simulateChromeFormatRange() {
  const original = Intl.DateTimeFormat.prototype.formatRange
  vi.spyOn(Intl.DateTimeFormat.prototype, 'formatRange').mockImplementation(function (
    this: Intl.DateTimeFormat,
    start,
    end,
  ) {
    return original.call(this, start, end).replace(/ /g, ' ')
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

// HON-777: the "Fill Sep 26 – Oct 2" label rendered U+2009 on the server and
// U+0020 in the browser, so Today failed to hydrate with React error 418.
describe('FillDaysAction hydration', () => {
  it.each(['en', 'et'] as const)(
    'hydrates the range label without a mismatch in %s',
    async (locale) => {
      const html = renderToString(tree(locale))

      simulateChromeFormatRange()
      const container = document.createElement('div')
      container.innerHTML = html
      document.body.appendChild(container)
      const onRecoverableError = vi.fn()

      await act(async () => {
        hydrateRoot(container, tree(locale), { onRecoverableError })
      })

      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container.textContent).not.toMatch(/ /)
      container.remove()
    },
  )
})

import { describe, expect, it, vi } from 'vitest'
// The real provider, so the Estonian catalog and its plurals render (HON-1388).
vi.unmock('next-intl')
import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { CookedLine } from './CookedLine'

const TODAY = '2026-10-28'

function line(
  lastCookedOn: string | null,
  { nextPlannedOn = null as string | null, locale = 'en' } = {},
) {
  const { container } = render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      <CookedLine lastCookedOn={lastCookedOn} nextPlannedOn={nextPlannedOn} today={TODAY} />
    </NextIntlClientProvider>,
  )
  return container.textContent
}

describe('CookedLine', () => {
  it.each([
    ['2026-10-28', 'Cooked today'],
    ['2026-10-27', 'Cooked yesterday'],
    ['2026-10-16', 'Cooked 12 days ago'],
    ['2026-10-15', 'Cooked 13 days ago'],
    ['2026-10-14', 'Cooked 2 weeks ago'],
    ['2026-08-27', 'Cooked 8 weeks ago'],
    ['2026-08-26', 'Cooked 2 months ago'],
  ])('says a meal cooked on %s was "%s"', (lastCookedOn, expected) => {
    expect(line(lastCookedOn)).toBe(expected)
  })

  it('says a meal never cooked is not cooked yet', () => {
    expect(line(null)).toBe('Not cooked yet')
  })

  it('adds the next planned day', () => {
    // 31 October 2026 is a Saturday.
    expect(line('2026-10-16', { nextPlannedOn: '2026-10-31' })).toBe(
      'Cooked 12 days ago · Planned: Sat, Oct 31',
    )
  })

  it.each([
    ['2026-10-28', 'Tehtud täna'],
    ['2026-10-27', 'Tehtud eile'],
    ['2026-10-16', 'Tehtud 12 päeva tagasi'],
    ['2026-10-14', 'Tehtud 2 nädalat tagasi'],
    ['2026-08-26', 'Tehtud 2 kuud tagasi'],
    [null, 'Pole veel tehtud'],
  ])('says it in Estonian for %s: "%s"', (lastCookedOn, expected) => {
    expect(line(lastCookedOn, { locale: 'et' })).toBe(expected)
  })

  it('names the next planned day in Estonian', () => {
    expect(line(null, { nextPlannedOn: '2026-10-31', locale: 'et' })).toBe(
      'Pole veel tehtud · Plaanis: L, 31. okt',
    )
  })
})

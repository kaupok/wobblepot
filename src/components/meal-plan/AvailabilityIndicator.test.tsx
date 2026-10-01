import { describe, it, expect, vi } from 'vitest'
// vitest.setup.ts mocks next-intl to English only; use the real provider so the
// `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { AvailabilityIndicator } from './AvailabilityIndicator'

function renderIndicator(locale: 'en' | 'et', missingCount: number) {
  const messages = locale === 'et' ? etMessages : enMessages
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <AvailabilityIndicator
        availability={{
          isReady: missingCount === 0,
          missingCount,
          missingIngredients: Array.from({ length: missingCount }, (_, i) => `ingredient-${i}`),
        }}
      />
    </NextIntlClientProvider>,
  )
}

describe('AvailabilityIndicator', () => {
  it.each([
    ['en', 1, '1 ingredient to buy'],
    ['en', 2, '2 ingredients to buy'],
    ['et', 1, 'Vaja osta 1 koostisosa'],
    ['et', 2, 'Vaja osta 2 koostisosa'],
  ] as const)('names the ingredients to buy (%s, %i)', (locale, count, text) => {
    renderIndicator(locale, count)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it.each([
    ['en', 'Have all ingredients'],
    ['et', 'Kõik koostisosad olemas'],
  ] as const)('says the household has everything when ready (%s)', (locale, text) => {
    renderIndicator(locale, 0)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})

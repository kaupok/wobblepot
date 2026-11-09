import { describe, expect, it, vi } from 'vitest'
// vitest.setup.ts mocks next-intl to English only; use the real provider so the
// `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { AvailabilityIndicator, AvailabilityStatus } from './AvailabilityIndicator'

function indicatorElement(
  locale: 'en' | 'et',
  missingCount: number,
  Component: typeof AvailabilityIndicator = AvailabilityIndicator,
) {
  const messages = locale === 'et' ? etMessages : enMessages
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Component
        availability={{
          isReady: missingCount === 0,
          missingCount,
          missingIngredients: Array.from({ length: missingCount }, (_, i) => `ingredient-${i}`),
        }}
      />
    </NextIntlClientProvider>
  )
}

function statusElement(locale: 'en' | 'et', missingCount: number) {
  return indicatorElement(locale, missingCount, AvailabilityStatus)
}

function renderIndicator(
  locale: 'en' | 'et',
  missingCount: number,
  Component: typeof AvailabilityIndicator = AvailabilityIndicator,
) {
  return render(indicatorElement(locale, missingCount, Component))
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
    ['et', 'Kõik olemas'],
  ] as const)('says the household has everything when ready (%s)', (locale, text) => {
    renderIndicator(locale, 0)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})

// The cook view's Ingredients line (HON-1025): plain text after the heading.
describe('AvailabilityStatus', () => {
  it.each([
    ['en', 1, '1 to buy'],
    ['en', 2, '2 to buy'],
    ['et', 1, '1 vaja osta'],
    ['et', 2, '2 vaja osta'],
  ] as const)('names the count to buy in the warning tone (%s, %i)', (locale, count, text) => {
    renderIndicator(locale, count, AvailabilityStatus)
    const status = screen.getByText(text)
    expect(status).toHaveClass('text-warning')
    expect(status.closest('[data-slot="badge"]')).toBeNull()
  })

  // HON-1620: with everything at home the ticked rows say it, so the line
  // shows only the heading.
  it.each(['en', 'et'] as const)('shows nothing when everything is at home (%s)', (locale) => {
    const { container } = renderIndicator(locale, 0, AvailabilityStatus)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('all at home')).toBeNull()
    expect(screen.queryByText('kõik olemas')).toBeNull()
  })

  it('appears when an ingredient goes missing and disappears when it is back', () => {
    const { container, rerender } = renderIndicator('en', 0, AvailabilityStatus)
    expect(container).toBeEmptyDOMElement()

    rerender(statusElement('en', 1))
    expect(screen.getByText('1 to buy')).toBeInTheDocument()

    rerender(statusElement('en', 0))
    expect(container).toBeEmptyDOMElement()
  })
})

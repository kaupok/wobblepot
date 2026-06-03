// Use the real next-intl in this file: the global mock in vitest.setup.ts
// hardcodes English; this suite asserts locale-switched rendering.
import { vi, describe, it, expect } from 'vitest'
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { PropsWithChildren } from 'react'
import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'
import { NutritionDisclaimer } from './NutritionDisclaimer'

function makeWrapper(locale: 'en' | 'et') {
  const messages = locale === 'et' ? etMessages : enMessages
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    )
  }
}

describe('NutritionDisclaimer', () => {
  it('renders the English disclaimer copy', () => {
    render(<NutritionDisclaimer />, { wrapper: makeWrapper('en') })
    expect(screen.getByText(/are not medical advice/i)).toBeInTheDocument()
  })

  it('renders the Estonian disclaimer copy', () => {
    render(<NutritionDisclaimer />, { wrapper: makeWrapper('et') })
    expect(screen.getByText(/meditsiiniline nõuanne/i)).toBeInTheDocument()
  })
})

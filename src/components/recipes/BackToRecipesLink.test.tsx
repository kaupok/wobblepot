import { describe, expect, it, vi } from 'vitest'
// The default next-intl mock resolves English only; the real provider lets the
// Estonian name be asserted too.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { BackToRecipesLink } from './BackToRecipesLink'

describe('BackToRecipesLink', () => {
  it.each([
    ['en', enMessages, 'Back to recipes'],
    ['et', etMessages, 'Tagasi retseptide juurde'],
  ])('links to /recipes, named in %s', (locale, messages, name) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <BackToRecipesLink />
      </NextIntlClientProvider>,
    )

    expect(screen.getByRole('link', { name })).toHaveAttribute('href', '/recipes')
  })
})

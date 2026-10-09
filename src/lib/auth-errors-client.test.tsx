// Use the real next-intl in this file: the global mock in vitest.setup.ts
// hardcodes English; this suite checks the Estonian copy too.
import { vi, describe, it, expect } from 'vitest'
vi.unmock('next-intl')
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { PropsWithChildren } from 'react'
import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'
import { useAuthErrorMessage } from './auth-errors-client'

function render(locale: 'en' | 'et') {
  const messages = locale === 'et' ? etMessages : enMessages
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    )
  }
  return renderHook(() => useAuthErrorMessage(), { wrapper: Wrapper }).result.current
}

// Sign-up and reset-password render server errors through this hook; their own
// tests mock it.
describe('useAuthErrorMessage', () => {
  it('renders the generic copy for an empty message', () => {
    expect(render('en')('')).toBe('An unexpected error occurred. Please try again.')
  })

  it('tells the user to shorten a password over the limit (HON-1142)', () => {
    expect(render('en')('Password too long')).toBe('Use a password of 128 characters or fewer.')
    expect(render('et')('Password too long')).toBe('Kasuta parooli, mis on kuni 128 märki pikk.')
  })

  it('returns an unmapped message unchanged', () => {
    expect(render('en')('Something new broke')).toBe('Something new broke')
  })
})

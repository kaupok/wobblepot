import { describe, expect, it, vi } from 'vitest'
// `t.rich` returns React elements, which the default vitest next-intl mock
// (a plain string-resolver) cannot handle. Use the real provider so the
// `<link>{email}</link>` markup actually renders an anchor.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../messages/en.json'
import ErrorBoundary from './error'

vi.mock('@/lib/errors-client', () => ({
  captureClientError: vi.fn().mockResolvedValue(undefined),
}))

function makeError(): Error & { digest?: string } {
  return Object.assign(new Error('boom'), { digest: 'abc-123' })
}

describe('error.tsx (route error boundary)', () => {
  it('renders the support email link', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ErrorBoundary error={makeError()} reset={vi.fn()} />
      </NextIntlClientProvider>,
    )

    const link = screen.getByRole('link', { name: /support@honkadori\.xyz/i })
    expect(link).toHaveAttribute('href', 'mailto:support@honkadori.xyz')
  })
})

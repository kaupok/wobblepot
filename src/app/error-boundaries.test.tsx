import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
// The boundaries call `t.rich`, which the default vitest next-intl mock cannot
// render. Use the real provider, as `error.test.tsx` does.
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../messages/en.json'

vi.mock('@/lib/errors-client', () => ({
  captureClientError: vi.fn().mockResolvedValue(undefined),
}))

type ErrorBoundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>

// Every route `error.tsx`, globbed so a boundary added later is covered too.
// `global-error.tsx` is not matched: it renders its own <html> and has its own test.
// The tsconfig does not load `vite/client`, so `glob` is untyped here and the
// eager result is cast to what it returns at runtime.
const boundaries = import.meta.glob('./**/error.tsx', { eager: true }) as unknown as Record<
  string,
  { default: ErrorBoundary }
>

// A boundary replaces the page's content, so its title is the page's h1 (HON-826).
describe('route error boundaries', () => {
  it('finds every boundary', () => {
    expect(Object.keys(boundaries).length).toBeGreaterThanOrEqual(16)
  })

  it.each(Object.entries(boundaries))('%s renders its title as the only h1', (_, mod) => {
    const Boundary = mod.default
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Boundary error={new Error('boom')} reset={vi.fn()} />
      </NextIntlClientProvider>,
    )

    const headings = screen.getAllByRole('heading')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.tagName).toBe('H1')
  })
})

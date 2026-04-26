import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NotFound from './not-found'
import enMessages from '../../messages/en.json'

// Resolve `getTranslations('errors.notFound')` against the real en catalog so
// the async server component renders without pulling in the next-intl request
// pipeline.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace: string) => {
    const segments = namespace.split('.')
    let cursor: unknown = enMessages
    for (const segment of segments) {
      cursor = (cursor as Record<string, unknown>)?.[segment]
    }
    return (key: string) => (cursor as Record<string, string>)?.[key] ?? key
  }),
}))

describe('NotFound', () => {
  it('renders the heading and description', async () => {
    const component = await NotFound()
    render(component)

    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
    expect(
      screen.getByText(/the page you're looking for doesn't exist or has been moved/i),
    ).toBeInTheDocument()
  })

  it('renders a link to the home page', async () => {
    const component = await NotFound()
    render(component)

    const link = screen.getByRole('link', { name: /go home/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/')
  })
})

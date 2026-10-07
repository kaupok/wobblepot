import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import enMessages from '../../../../messages/en.json'
import StopRemindersPage, { generateMetadata } from './page'

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({
        locale: 'en',
        messages: enMessages as never,
        namespace: namespace as never,
      }),
    ),
  }
})

// The form is a client component with its own test; here only which branch renders.
vi.mock('./StopRemindersForm', () => ({
  StopRemindersForm: ({ token }: { token: string }) => <div data-testid="stop-form">{token}</div>,
}))

async function renderPage(searchParams: { token?: string | string[] }) {
  render(await StopRemindersPage({ searchParams: Promise.resolve(searchParams) }))
}

describe('/reminders/stop', () => {
  it('renders the stop form for a token, without stopping anything on open', async () => {
    await renderPage({ token: 'token-1' })

    expect(screen.getByTestId('stop-form')).toHaveTextContent('token-1')
  })

  it('points to the Household page when the link has no token', async () => {
    await renderPage({})

    expect(screen.queryByTestId('stop-form')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household page' })).toHaveAttribute(
      'href',
      '/household',
    )
  })

  it('treats a repeated token as incomplete', async () => {
    await renderPage({ token: ['a', 'b'] })

    expect(screen.queryByTestId('stop-form')).not.toBeInTheDocument()
  })

  it('keeps the page out of search indexes', async () => {
    const metadata = await generateMetadata()

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

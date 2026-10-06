import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// `t.rich` (the privacy link) returns React elements, which the default
// next-intl test mock cannot handle; use the real provider.
vi.unmock('next-intl')
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { RequestInviteForm } from './RequestInviteForm'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderForm(locale: 'en' | 'et' = 'en') {
  const { wrapper: Wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'et' ? etMessages : enMessages}>
      <Wrapper>
        <RequestInviteForm />
      </Wrapper>
    </NextIntlClientProvider>,
  )
}

async function submit(user: ReturnType<typeof userEvent.setup>, email = 'me@example.com') {
  await user.type(screen.getByLabelText('Email'), email)
  await user.click(screen.getByRole('button', { name: 'Ask for an invite' }))
}

describe('RequestInviteForm', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders one email field, the button, the privacy line and the household line', () => {
    renderForm()

    expect(screen.getByRole('heading', { level: 1, name: 'Ask for an invite' })).toBeInTheDocument()
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toHaveAttribute('autocomplete', 'email')
    expect(input).toBeRequired()
    expect(screen.getByRole('button', { name: 'Ask for an invite' })).toBeInTheDocument()
    expect(
      screen.getByText(/We keep your address only to send the invite\. See the/),
    ).toHaveTextContent('We keep your address only to send the invite. See the privacy policy.')
    expect(screen.getByRole('link', { name: 'privacy policy' })).toHaveAttribute('href', '/privacy')
    expect(
      screen.getByText("Joining someone's household? Use the link they sent you."),
    ).toBeInTheDocument()
  })

  it('renders in Estonian', () => {
    renderForm('et')

    expect(screen.getByRole('heading', { level: 1, name: 'Küsi kutset' })).toBeInTheDocument()
    expect(screen.getByLabelText('E-post')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'privaatsuspoliitikat' })).toHaveAttribute(
      'href',
      '/privacy',
    )
  })

  it('posts the trimmed email and the page locale, then says to check the email', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    const user = userEvent.setup({ delay: null })
    renderForm('et')

    await user.type(screen.getByLabelText('E-post'), '  me@example.com ')
    await user.click(screen.getByRole('button', { name: 'Küsi kutset' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      'Vaata oma postkasti. Saatsime kinnituslingi aadressile me@example.com.',
    )
    expect(status).toHaveFocus()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/waitlist')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ email: 'me@example.com', locale: 'et' })
  })

  it('shows the sent message in English', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
    const user = userEvent.setup({ delay: null })
    renderForm()

    await submit(user)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Check your email. We sent a confirmation link to me@example.com. Click it within 7 days to join the list.',
    )
  })

  it('shows the rate-limit copy on a 429, not the server text', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'Too many requests' }))
    const user = userEvent.setup({ delay: null })
    renderForm()

    await submit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many tries. Try again in an hour.')
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-describedby', 'form-error')
  })

  it('shows the generic copy for any other failure and logs the server text', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'Sign-up is open' }))
    const user = userEvent.setup({ delay: null })
    renderForm()

    await submit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We couldn't send your request. Try again.")
    expect(alert).not.toHaveTextContent('Sign-up is open')
    expect(console.error).toHaveBeenCalledWith('[request-invite] request failed', {
      status: 409,
      error: 'Sign-up is open',
    })
  })

  it('returns focus to the submit button after a failure', async () => {
    let settle!: (response: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (settle = resolve)))
    const user = userEvent.setup({ delay: null })
    renderForm()

    await submit(user)
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    dropFocusToBody()

    await act(async () => settle(jsonResponse(500, { error: 'boom' })))

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask for an invite' })).toHaveFocus()
    })
  })
})

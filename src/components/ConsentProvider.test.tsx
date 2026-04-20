import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsentProvider, useAnalyticsConsent } from '@/components/ConsentProvider'

function clearAllCookies() {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0]
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
  }
}

function Probe() {
  const { granted, grant, withdraw } = useAnalyticsConsent()
  return (
    <div>
      <p data-testid="granted">{String(granted)}</p>
      <button onClick={grant}>grant</button>
      <button onClick={withdraw}>withdraw</button>
    </div>
  )
}

beforeEach(() => {
  clearAllCookies()
  window.localStorage.clear()
})

afterEach(() => {
  delete (window as unknown as { posthog?: unknown }).posthog
})

describe('ConsentProvider', () => {
  it('starts undecided when no cookie is present and renders the banner', () => {
    render(
      <ConsentProvider initialDecision={null}>
        <Probe />
      </ConsentProvider>,
    )
    expect(screen.getByTestId('granted').textContent).toBe('null')
    expect(screen.getByRole('region', { name: /cookie consent/i })).toBeInTheDocument()
  })

  it('starts granted when the SSR cookie was "all" and hides the banner', () => {
    document.cookie = 'consent-v1=all; Path=/'
    render(
      <ConsentProvider initialDecision="all">
        <Probe />
      </ConsentProvider>,
    )
    expect(screen.getByTestId('granted').textContent).toBe('true')
    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument()
  })

  it('starts opted-out when the SSR cookie was "essential" and hides the banner', () => {
    document.cookie = 'consent-v1=essential; Path=/'
    render(
      <ConsentProvider initialDecision="essential">
        <Probe />
      </ConsentProvider>,
    )
    expect(screen.getByTestId('granted').textContent).toBe('false')
    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument()
  })

  it('falls back to undecided if the cookie disappears between SSR and hydration', async () => {
    render(
      <ConsentProvider initialDecision="all">
        <Probe />
      </ConsentProvider>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    // Cookie was cleared (beforeEach) — provider reconciles to undecided and shows banner.
    expect(screen.getByTestId('granted').textContent).toBe('null')
    expect(screen.getByRole('region', { name: /cookie consent/i })).toBeInTheDocument()
  })

  it('grant() writes the cookie, flips state, and opts PostHog in if loaded', async () => {
    const user = userEvent.setup()
    const optIn = vi.fn()
    ;(window as unknown as { posthog: unknown }).posthog = { opt_in_capturing: optIn }

    render(
      <ConsentProvider initialDecision={null}>
        <Probe />
      </ConsentProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'grant' }))

    expect(screen.getByTestId('granted').textContent).toBe('true')
    expect(document.cookie).toContain('consent-v1=all')
    expect(optIn).toHaveBeenCalledTimes(1)
  })

  it('withdraw() writes the cookie, flips state, opts PostHog out, and clears ph_* cookies', async () => {
    const user = userEvent.setup()
    const optOut = vi.fn()
    ;(window as unknown as { posthog: unknown }).posthog = { opt_out_capturing: optOut }
    document.cookie = 'ph_seeded=value; Path=/'

    render(
      <ConsentProvider initialDecision="all">
        <Probe />
      </ConsentProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'withdraw' }))

    expect(screen.getByTestId('granted').textContent).toBe('false')
    expect(document.cookie).toContain('consent-v1=essential')
    expect(document.cookie).not.toContain('ph_seeded=value')
    expect(optOut).toHaveBeenCalledTimes(1)
  })

  it('reconciles with the client cookie on mount if SSR and client disagree', async () => {
    document.cookie = 'consent-v1=all; Path=/'
    render(
      <ConsentProvider initialDecision={null}>
        <Probe />
      </ConsentProvider>,
    )
    // Mount effect runs synchronously in RTL; the probe should already show true.
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId('granted').textContent).toBe('true')
  })

  it('throws when useAnalyticsConsent is called outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/useAnalyticsConsent must be used within/)
    spy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock in vitest.setup.ts resolves every key against the
// English catalog, so it cannot tell a translated string from an untranslated
// one — which is the entire bug under test here (HON-697). Use the real
// provider so the `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { JoinHouseholdCard } from './JoinHouseholdCard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

/** Verbatim from `POST /api/invites/[code]/join`'s `invite_not_found` branch. */
const SERVER_PROSE = 'Invite code not found.'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'et' ? etMessages : enMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

function respondWith(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve(body),
      }),
    ),
  )
}

async function clickJoin(locale: 'en' | 'et') {
  renderInLocale(
    <JoinHouseholdCard status="valid" householdName="Kõrv" memberName={null} code="ABC123" />,
    locale,
  )
  fireEvent.click(screen.getByRole('button', { name: locale === 'et' ? /liitu/i : /join/i }))
}

describe('JoinHouseholdCard error localization', () => {
  beforeEach(() => {
    // The breadcrumb the card writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // `invite_not_found` reaches this card only when the invite vanished between
  // render and click (`page.tsx` `notFound()`s on a code that never resolved),
  // which is the commoner half of the race `invite_invalid` describes — so it
  // shares that copy rather than the generic fallback.
  it('renders the Estonian invite_invalid copy for invite_not_found, never the server prose', async () => {
    respondWith({ error: 'invite_not_found', message: SERVER_PROSE }, 404)

    await clickJoin('et')

    await screen.findByText(etMessages.auth.invite.errors.inviteInvalid)
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('renders the English invite_invalid copy for invite_not_found on the en locale', async () => {
    respondWith({ error: 'invite_not_found', message: SERVER_PROSE }, 404)

    await clickJoin('en')

    await screen.findByText(enMessages.auth.invite.errors.inviteInvalid)
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('renders the translated fallback for any code it has no branch for', async () => {
    // Pins the whole class, not just `invite_not_found`: a future route branch
    // that ships English prose must not reach the user either.
    respondWith({ error: 'some_future_code', message: 'Some untranslated English.' }, 500)

    await clickJoin('et')

    await screen.findByText(etMessages.auth.invite.errors.joinFailed)
    expect(screen.queryByText('Some untranslated English.')).not.toBeInTheDocument()
  })

  it('renders the English generic fallback for an unbranched code on the en locale', async () => {
    respondWith({ error: 'some_future_code', message: 'Some untranslated English.' }, 500)

    await clickJoin('en')

    await screen.findByText(enMessages.auth.invite.errors.joinFailed)
    expect(screen.queryByText('Some untranslated English.')).not.toBeInTheDocument()
  })

  it('keeps the server prose reachable as a console breadcrumb', async () => {
    respondWith({ error: 'invite_not_found', message: SERVER_PROSE }, 404)

    await clickJoin('et')

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith('[invite-join] request failed', {
        error: 'invite_not_found',
        message: SERVER_PROSE,
      }),
    )
  })

  it('still renders its own key for already_in_household', async () => {
    respondWith(
      { error: 'already_in_household', message: 'You are already a member of a household.' },
      400,
    )

    await clickJoin('et')

    await screen.findByText(etMessages.auth.invite.errors.alreadyInHousehold)
    expect(screen.queryByText(etMessages.auth.invite.errors.joinFailed)).not.toBeInTheDocument()
  })

  it('still renders its own key for invite_invalid', async () => {
    respondWith(
      { error: 'invite_invalid', message: 'This invite has expired or has already been used.' },
      400,
    )

    await clickJoin('et')

    await screen.findByText(etMessages.auth.invite.errors.inviteInvalid)
    expect(screen.queryByText(etMessages.auth.invite.errors.joinFailed)).not.toBeInTheDocument()
  })
})

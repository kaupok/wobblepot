import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock in vitest.setup.ts resolves every key against the
// English catalog, so it cannot tell a translated string from an untranslated
// one — which is the entire bug under test here (HON-697). Use the real
// provider so the `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
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
  const { wrapper } = createQueryWrapper()
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
    { wrapper },
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

// Each status renders its own card, and that card's title is the page's h1 (HON-826).
describe('JoinHouseholdCard page heading', () => {
  it.each([
    { status: 'valid', memberName: null, title: 'Join household' },
    { status: 'valid', memberName: 'Mari', title: 'Join as Mari' },
    { status: 'already_member', memberName: null, title: 'Already a member' },
    { status: 'invalid', memberName: null, title: 'Invite expired' },
  ] as const)('renders the $status title as the only h1', ({ status, memberName, title }) => {
    renderInLocale(
      <JoinHouseholdCard
        status={status}
        householdName="Kõrv"
        memberName={memberName}
        code="ABC123"
      />,
      'en',
    )

    const headings = screen.getAllByRole('heading')
    expect(headings).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBe(headings[0])
  })
})

describe('JoinHouseholdCard for a signed-out visitor (HON-1131)', () => {
  it('names the household and member, with Create account first and Sign in second', () => {
    renderInLocale(
      <JoinHouseholdCard
        status="signed_out"
        householdName="Smith Family"
        memberName="Partner"
        code="Ab3_x-9Kq2Lm"
      />,
      'en',
    )

    expect(screen.getByRole('heading', { name: 'Join as Partner' })).toBeInTheDocument()
    expect(screen.getByText('Smith Family')).toBeInTheDocument()

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Create account', 'Sign in'])
    expect(links[0]).toHaveAttribute('href', '/sign-up?invite=Ab3_x-9Kq2Lm')
    expect(links[1]).toHaveAttribute('href', '/sign-in?returnUrl=%2Finvite%2FAb3_x-9Kq2Lm')
    // No join button: there is no session to join with.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the Estonian copy', () => {
    renderInLocale(
      <JoinHouseholdCard status="signed_out" householdName="Kõrv" memberName="Mari" code="abc" />,
      'et',
    )

    expect(screen.getByRole('link', { name: 'Loo konto' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Logi sisse' })).toBeInTheDocument()
  })
})

// A signed-in visitor who already has a household (HON-1133).
describe('JoinHouseholdCard for a member of another household', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const OWN_HOUSEHOLD = { name: 'Mari kodu', deletesHousehold: true, otherAccountCount: 0 }

  function renderLeaveAndJoin(currentHousehold = OWN_HOUSEHOLD, locale: 'en' | 'et' = 'en') {
    renderInLocale(
      <JoinHouseholdCard
        status="leave_and_join"
        householdName="Kõrv"
        memberName="Mari"
        code="ABC123"
        currentHousehold={currentHousehold}
      />,
      locale,
    )
  }

  it('says a sole owner loses their household, and leaves and joins on confirm', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderLeaveAndJoin()

    expect(screen.getByRole('heading', { level: 1, name: 'Join "Kõrv"?' })).toBeInTheDocument()
    expect(
      screen.getByText(/Your household "Mari kodu" .* are deleted\. This cannot be undone\./),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Leave and join' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave and join' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/invites/ABC123/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaveCurrent: true }),
      }),
    )
  })

  it('tells a member their old household keeps its plan', () => {
    renderLeaveAndJoin({ name: 'Mari kodu', deletesHousehold: false, otherAccountCount: 0 })

    expect(
      screen.getByText('You leave "Mari kodu". Its plan stays with the household.'),
    ).toBeInTheDocument()
  })

  it('shows the invalid-invite copy on the card when the invite was used in between', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    respondWith({ error: 'invite_invalid', message: 'x' }, 400)
    renderLeaveAndJoin()

    fireEvent.click(screen.getByRole('button', { name: 'Leave and join' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave and join' }))

    await screen.findByText(enMessages.auth.invite.errors.inviteInvalid)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('renders the Estonian title', () => {
    renderLeaveAndJoin(OWN_HOUSEHOLD, 'et')

    expect(
      screen.getByRole('heading', { level: 1, name: 'Liitud leibkonnaga „Kõrv"?' }),
    ).toBeInTheDocument()
  })

  it('points an owner with other account holders to the household page, with no join button', () => {
    renderInLocale(
      <JoinHouseholdCard
        status="cannot_leave"
        householdName="Kõrv"
        memberName="Mari"
        code="ABC123"
        currentHousehold={{ name: 'Mari kodu', deletesHousehold: false, otherAccountCount: 2 }}
      />,
      'en',
    )

    expect(screen.getByText(/2 other members have an account there/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Household' })).toHaveAttribute(
      'href',
      '/household',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// Real provider, so the Estonian assertion reads the et catalog rather than
// the global mock's English one.
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { dropFocusToBody } from '@/test/focus'
import { LeaveHouseholdDialog } from './LeaveHouseholdDialog'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

type Props = Parameters<typeof LeaveHouseholdDialog>[0]

function renderDialog(props: Partial<Props> = {}, locale: 'en' | 'et' = 'en') {
  const messages = locale === 'et' ? etMessages : enMessages
  const { wrapper: QueryWrapper } = createQueryWrapper()
  render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LeaveHouseholdDialog
          householdName="Kõrvid"
          isOwner={false}
          accountMemberCount={1}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

function respondWith(body: unknown, status: number) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function openAndConfirm() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Leave household' }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Leave household' }))
  return dialog
}

describe('LeaveHouseholdDialog', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    push.mockClear()
    refresh.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lets a member leave and sends them to onboarding', async () => {
    const fetchMock = respondWith({ deletedHousehold: false }, 200)
    renderDialog()

    const dialog = await openAndConfirm()

    expect(within(dialog).getByText(/Its plan stays with the household/)).toBeInTheDocument()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding'))
    expect(refresh).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/api/households/me/leave', { method: 'POST' })
  })

  it('tells a sole-account owner that the household is deleted', async () => {
    renderDialog({ isOwner: true, accountMemberCount: 1 })

    expect(screen.getByText(/leaving deletes this household/)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Leave household' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Your household "Kõrvid" .* are deleted\. This cannot be undone\./),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/download your data from your profile/)).toBeInTheDocument()
  })

  it('shows an owner with other account holders the reason instead of the button', () => {
    renderDialog({ isOwner: true, accountMemberCount: 3 })

    expect(screen.queryByRole('button', { name: 'Leave household' })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'You own this household, and 2 other members have an account. Remove them from the household before you leave.',
      ),
    ).toBeInTheDocument()
  })

  it('renders the owner warning in Estonian', () => {
    renderDialog({ isOwner: true, accountMemberCount: 2 }, 'et')

    expect(
      screen.getByText(
        'Oled selle leibkonna omanik ja siin on 1 muu kontoga liige. Eemalda nad leibkonnast enne lahkumist.',
      ),
    ).toBeInTheDocument()
  })

  it('renders catalog copy for a 409, not the route body, and stays open', async () => {
    respondWith({ error: 'owner_has_other_accounts', count: 1 }, 409)
    renderDialog({ isOwner: true, accountMemberCount: 1 })

    const dialog = await openAndConfirm()

    await within(dialog).findByText(
      'You own this household, and 1 other member has an account. Remove them from the household before you leave.',
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('renders catalog copy for a 429', async () => {
    respondWith({ error: 'rate_limited', resetAt: '2030-01-01T00:00:00.000Z' }, 429)
    renderDialog()

    const dialog = await openAndConfirm()

    await within(dialog).findByText(
      'You have left a household 3 times in the last 30 days. Try again later.',
    )
  })

  it('returns focus to the confirm button after a failed leave', async () => {
    let fail: (value: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            fail = resolve
          }),
      ),
    )
    renderDialog()

    const dialog = await openAndConfirm()
    const confirm = within(dialog).getByRole('button', { name: 'Leaving…' })
    dropFocusToBody()
    fail({ ok: false, status: 500, json: () => Promise.resolve({ error: 'x' }) })

    await within(dialog).findByText('Could not leave the household. Try again.')
    await waitFor(() => expect(confirm).toHaveFocus())
  })
})

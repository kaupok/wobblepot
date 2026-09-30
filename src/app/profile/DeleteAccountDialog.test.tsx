import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock in vitest.setup.ts resolves every key against the
// English catalog, so it cannot tell a translated string from an untranslated
// one — which is the entire bug under test here (HON-725). Use the real
// provider so the `et` assertions below are meaningful.
vi.unmock('next-intl')
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { authClient } from '@/lib/auth-client'
import { createQueryWrapper } from '@/test/query-wrapper'
import { DeleteAccountDialog } from './DeleteAccountDialog'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

/** Verbatim shape of `DELETE /api/auth/user`'s `sole_owner` prose. */
const SOLE_OWNER_PROSE =
  'You are the sole owner of "Kõrvid" which has 2 other member(s). Please remove the other members first.'

function respondWith(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) })),
  )
}

async function openAndConfirm(locale: 'en' | 'et') {
  const user = userEvent.setup()
  const messages = locale === 'et' ? etMessages : enMessages
  const { wrapper: QueryWrapper } = createQueryWrapper()
  render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <DeleteAccountDialog userEmail="kaupo@example.com" />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
  await user.click(screen.getByRole('button', { name: messages.profile.delete.trigger }))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: messages.profile.delete.confirm }))
}

describe('DeleteAccountDialog error localization', () => {
  beforeEach(() => {
    // The breadcrumb the dialog writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the Estonian sole-owner copy with the household name and count, never the server prose', async () => {
    respondWith(
      {
        code: 'sole_owner',
        error: 'Cannot delete account',
        message: SOLE_OWNER_PROSE,
        householdName: 'Kõrvid',
        otherMemberCount: 2,
      },
      400,
    )

    await openAndConfirm('et')

    await screen.findByText(
      'Kontot ei saa veel kustutada: oled leibkonna „Kõrvid" ainus omanik ja seal on 2 muud liiget. Palun eemalda enne teised liikmed.',
    )
    expect(screen.queryByText(SOLE_OWNER_PROSE)).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith(
      '[delete-account] request failed',
      expect.objectContaining({ code: 'sole_owner', message: SOLE_OWNER_PROSE }),
    )
  })

  it('renders the Estonian delete-failed copy for delete_failed', async () => {
    respondWith({ code: 'delete_failed', error: 'Failed to delete account' }, 500)

    await openAndConfirm('et')

    await screen.findByText(etMessages.profile.delete.errors.deleteFailed)
    expect(screen.queryByText('Failed to delete account')).not.toBeInTheDocument()
  })

  it('falls back to the generic delete-failed copy for an unrecognised code', async () => {
    respondWith({ code: 'some_future_code', message: 'Something new went wrong.' }, 400)

    await openAndConfirm('et')

    await screen.findByText(etMessages.profile.delete.errors.deleteFailed)
    expect(screen.queryByText('Something new went wrong.')).not.toBeInTheDocument()
  })

  it('renders the English sole-owner copy on the en locale', async () => {
    respondWith(
      {
        code: 'sole_owner',
        message: SOLE_OWNER_PROSE,
        householdName: 'Kõrvid',
        otherMemberCount: 1,
      },
      400,
    )

    await openAndConfirm('en')

    await screen.findByText(
      'You can\'t delete your account yet: you are the only owner of "Kõrvid", which has 1 other member. Please remove the other members first.',
    )
  })
})

// An owner whose other members have no account is not blocked, and the
// purge deletes those members with the household — so the dialog lists the
// whole household, members without an account included, in both catalogs
// (HON-881).
describe('DeleteAccountDialog owner household line', () => {
  async function openAsOwner(locale: 'en' | 'et', accountMemberCount: number) {
    const user = userEvent.setup()
    const messages = locale === 'et' ? etMessages : enMessages
    const { wrapper: QueryWrapper } = createQueryWrapper()
    render(
      <QueryWrapper>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <DeleteAccountDialog
            userEmail="kaupo@example.com"
            householdName="Kõrvid"
            isOwner
            accountMemberCount={accountMemberCount}
          />
        </NextIntlClientProvider>
      </QueryWrapper>,
    )
    await user.click(screen.getByRole('button', { name: messages.profile.delete.trigger }))
    return screen.findByRole('alertdialog')
  }

  it.each([
    [
      'en' as const,
      'Your household "Kõrvid" and all its data (meal plans, pantry items, members without their own account, etc.)',
    ],
    [
      'et' as const,
      'Sinu leibkond „Kõrvid" ja kõik selle andmed (söögiplaanid, sahvri tooted, oma kontota liikmed jms)',
    ],
  ])(
    'lists the household for an owner who is the only account holder (%s)',
    async (locale, line) => {
      const messages = locale === 'et' ? etMessages : enMessages
      const dialog = await openAsOwner(locale, 1)

      expect(within(dialog).getByText(line)).toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', { name: messages.profile.delete.confirm }),
      ).toBeEnabled()
    },
  )

  it('blocks an owner with another account holder and omits the household line', async () => {
    const dialog = await openAsOwner('en', 2)

    expect(
      within(dialog).getByText(
        'Warning: You cannot delete your account because you are the owner of "Kõrvid" with 1 other member. Please remove the other members first.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/and all its data/)).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: enMessages.profile.delete.confirm }),
    ).toBeDisabled()
  })
})

describe('DeleteAccountDialog pending state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps the confirm button disabled from a successful delete until the redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ success: true, purgeScheduledFor: '2026-10-29T03:00:00.000Z' }),
        }),
      ),
    )
    let finishSignOut!: () => void
    vi.mocked(authClient.signOut).mockImplementation(
      () => new Promise((resolve) => (finishSignOut = () => resolve(undefined as never))),
    )

    await openAndConfirm('en')

    const dialog = screen.getByRole('alertdialog')
    const deleting = await within(dialog).findByRole('button', {
      name: enMessages.profile.delete.deleting,
    })
    expect(deleting).toBeDisabled()
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled())

    // Sign-out resolved, but the redirect has not landed — the account is gone,
    // so the button must not come back.
    finishSignOut()
    // Let the mutation settle, then assert without retrying: a `waitFor` would
    // pass on its first check, before the mutation had left `isPending`.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(
      within(dialog).getByRole('button', { name: enMessages.profile.delete.deleting }),
    ).toBeDisabled()
    expect(
      within(dialog).getByRole('button', { name: enMessages.profile.delete.cancel }),
    ).toBeDisabled()
  })
})

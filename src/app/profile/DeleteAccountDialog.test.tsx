import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock in vitest.setup.ts resolves every key against the
// English catalog, so it cannot tell a translated string from an untranslated
// one — which is the entire bug under test here (HON-725). Use the real
// provider so the `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { DeleteAccountDialog } from './DeleteAccountDialog'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

/** Verbatim shape of `DELETE /api/auth/user`'s `sole_owner` prose. */
const SOLE_OWNER_PROSE =
  'You are the sole owner of "Kõrvid" which has 2 other member(s). Please transfer ownership or remove other members first.'

function respondWith(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) })),
  )
}

async function openAndConfirm(locale: 'en' | 'et') {
  const user = userEvent.setup()
  const messages = locale === 'et' ? etMessages : enMessages
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DeleteAccountDialog userEmail="kaupo@example.com" />
    </NextIntlClientProvider>,
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
      'Kontot ei saa veel kustutada: oled leibkonna „Kõrvid" ainus omanik ja seal on 2 muud liiget. Palun anna omandiõigus üle või eemalda enne teised liikmed.',
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
      'You can\'t delete your account yet: you are the only owner of "Kõrvid", which has 1 other member. Please transfer ownership or remove other members first.',
    )
  })
})

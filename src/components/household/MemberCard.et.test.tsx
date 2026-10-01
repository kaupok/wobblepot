import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The global next-intl mock resolves against the English catalog only, which
// would pass whether or not the route's English `error` leaks (HON-914).
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { Member } from '@/types/member'
import { MemberCard } from './MemberCard'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const tMembers = etMessages.household.members

const member: Member = {
  id: 'member-2',
  userId: 'user-2',
  name: 'Mari',
  role: 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
  user: { id: 'user-2', name: 'Mari', email: 'mari@example.com', image: null },
  preferences: null,
  invite: null,
}

function respondWith(body: Record<string, unknown>, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

function renderCard() {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale="et" messages={etMessages}>
        <MemberCard
          member={member}
          canEdit={false}
          canRemove
          canInvite={false}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          onInvite={vi.fn()}
          onInviteUpdated={vi.fn()}
        />
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

async function confirmRemove() {
  await userEvent.click(screen.getByRole('button', { name: tMembers.removeAria }))
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: tMembers.removeDialog.confirm }))
}

describe('MemberCard in Estonian', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('labels the confirm dialog cancel button in Estonian', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: tMembers.removeAria }))
    const dialog = await screen.findByRole('alertdialog')

    expect(within(dialog).getByRole('button', { name: etMessages.common.cancel })).toBeVisible()
  })

  it('toasts the owner-only copy for a 403, not the route error', async () => {
    respondWith({ error: 'Only the household owner can remove members' }, 403)
    renderCard()

    await confirmRemove()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(tMembers.removeOwnerOnly)
    })
  })

  it('toasts the not-allowed copy for a 400', async () => {
    respondWith({ error: 'Cannot remove the household owner' }, 400)
    renderCard()

    await confirmRemove()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(tMembers.removeNotAllowed)
    })
  })

  it('toasts the generic failure for anything else', async () => {
    respondWith({ error: 'Failed to remove member' }, 500)
    renderCard()

    await confirmRemove()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(tMembers.removeFailed)
    })
  })
})

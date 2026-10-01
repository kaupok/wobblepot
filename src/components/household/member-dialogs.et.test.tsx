import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'

// The global next-intl mock resolves against the English catalog only, which
// would pass whether or not the route's English `error` leaks (HON-914).
vi.unmock('next-intl')
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import type { Member } from '@/types/member'
import { EditMemberPreferencesDialog } from './EditMemberPreferencesDialog'
import { MemberInviteDialog } from './MemberInviteDialog'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const member: Member = {
  id: 'member-2',
  userId: null,
  name: 'Mari',
  role: 'member',
  joinedAt: '2026-01-01T00:00:00.000Z',
  user: null,
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

function renderInEstonian(node: ReactNode) {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale="et" messages={etMessages}>
        {node}
      </NextIntlClientProvider>
    </QueryWrapper>,
  )
}

describe('member dialogs in Estonian', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('MemberInviteDialog shows the Estonian failure, not the route error', async () => {
    respondWith({ error: 'Only household owners can create invites' }, 403)
    renderInEstonian(
      <MemberInviteDialog
        open
        onOpenChange={vi.fn()}
        memberId={member.id}
        memberName="Mari"
        existingInvite={null}
        onInviteCreated={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: etMessages.household.invite.create }))

    expect(
      await screen.findByText(etMessages.household.invite.errors.createFailed),
    ).toBeInTheDocument()
    expect(screen.queryByText('Only household owners can create invites')).not.toBeInTheDocument()
  })

  it('EditMemberPreferencesDialog shows the Estonian failure, not the route error', async () => {
    respondWith({ error: 'Validation failed' }, 400)
    renderInEstonian(
      <EditMemberPreferencesDialog
        member={member}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        isManualMember
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: etMessages.household.editMember.submit }),
    )

    expect(
      await screen.findByText(etMessages.household.editMember.errors.saveFailed),
    ).toBeInTheDocument()
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
  })
})

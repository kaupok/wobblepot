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
import { AddMemberDialog } from './AddMemberDialog'
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

  it('AddMemberDialog has one name field with the Estonian placeholder', async () => {
    renderInEstonian(<AddMemberDialog onMemberAdded={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: etMessages.household.addMember.trigger }),
    )

    expect(screen.getByLabelText(etMessages.household.addMember.nameLabel)).toHaveAttribute(
      'placeholder',
      'nt Mia',
    )
    expect(screen.queryByLabelText(/hüüdnimi/i)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Väike (0,75×)' })).toBeInTheDocument()
  })

  it('EditMemberPreferencesDialog folds a manual member display name into the name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(member), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderInEstonian(
      <EditMemberPreferencesDialog
        member={{
          ...member,
          preferences: {
            displayName: 'Mari-Liis',
            portionMultiplier: 1.25,
            targetCalories: null,
            targetProtein: null,
            targetCarbs: null,
            targetFat: null,
            dietaryType: null,
            allergens: [],
            restrictions: [],
            excludedIngredients: [],
            excludedIngredientIds: [],
          },
        }}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        isManualMember
      />,
    )

    expect(screen.getByText(etMessages.household.editMember.description)).toBeInTheDocument()
    expect(screen.queryByLabelText(/hüüdnimi/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(etMessages.household.editMember.nameLabel)).toHaveValue(
      'Mari-Liis',
    )
    expect(
      screen.getByRole('radio', { name: etMessages.household.portion.custom }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('× tavaline portsjon')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: etMessages.household.editMember.submit }),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Mari-Liis',
      preferences: { displayName: null, portionMultiplier: 1.25 },
    })
  })

  it('EditMemberPreferencesDialog refuses an empty name for a manual member', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderInEstonian(
      <EditMemberPreferencesDialog
        member={member}
        open
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        isManualMember
      />,
    )

    // `required` stops a real browser before the handler runs; drop it so the
    // test reaches the handler's own guard.
    const nameInput = screen.getByLabelText(etMessages.household.editMember.nameLabel)
    await userEvent.clear(nameInput)
    nameInput.removeAttribute('required')
    await userEvent.click(
      screen.getByRole('button', { name: etMessages.household.editMember.submit }),
    )

    expect(
      await screen.findByText(etMessages.household.editMember.errors.nameRequired),
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi } from 'vitest'

// The global next-intl mock does not format `{multiplier, number}`; the real
// provider does, and the short portion copy is what these tests read.
vi.unmock('next-intl')
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createMemberPreferences } from '@/stories/fixtures'
import type { Member } from '@/types/member'
import { MemberRow } from './MemberRow'

const owner: Member = {
  id: 'member-1',
  userId: 'user-1',
  name: 'Kaupo',
  role: 'owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
  user: { id: 'user-1', name: 'Kaupo', email: 'kaupo@example.com', image: null },
  preferences: null,
  invite: null,
}

const manual: Member = {
  ...owner,
  id: 'member-2',
  userId: null,
  name: 'Mari',
  role: 'member',
  user: null,
}

function renderRow(props: Partial<ComponentProps<typeof MemberRow>> = {}) {
  const handlers = { onEdit: vi.fn(), onRemove: vi.fn(), onRemoveFocus: vi.fn(), onInvite: vi.fn() }
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ul>
        <MemberRow
          member={owner}
          canEdit
          canRemove={false}
          canInvite={false}
          onInviteUpdated={vi.fn()}
          {...handlers}
          {...props}
        />
      </ul>
    </NextIntlClientProvider>,
    createQueryWrapper(),
  )
  return handlers
}

describe('MemberRow', () => {
  it('opens the edit dialog from a button named by the member', async () => {
    const { onEdit } = renderRow()

    const button = screen.getByRole('button', { name: 'Kaupo' })
    await userEvent.click(button)

    expect(onEdit).toHaveBeenCalledWith(owner, button)
  })

  it('renders the name as plain text when the viewer cannot edit', () => {
    renderRow({ canEdit: false })

    expect(screen.getByText('Kaupo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kaupo' })).not.toBeInTheDocument()
  })

  it('shows the portion in short form', () => {
    renderRow({
      member: { ...owner, preferences: createMemberPreferences({ portionMultiplier: 1.5 }) },
    })

    expect(screen.getByText('Large 1.5×')).toBeInTheDocument()
  })

  it('shows a custom portion in short form', () => {
    renderRow({
      member: { ...owner, preferences: createMemberPreferences({ portionMultiplier: 1.3 }) },
    })

    expect(screen.getByText('Custom 1.3×')).toBeInTheDocument()
  })

  it('marks the owner and has no menu when the viewer may neither invite nor remove', () => {
    renderRow()

    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
  })

  it('badges a member without an account "No account" until an invite is active', () => {
    renderRow({ member: manual })
    expect(screen.getByText('No account')).toBeInTheDocument()
    expect(screen.queryByText('Invite pending')).not.toBeInTheDocument()
  })

  it('badges an active invite "Invite pending" instead of "No account"', () => {
    renderRow({
      member: {
        ...manual,
        invite: { url: 'https://example.com/invite/x', expiresAt: '2026-12-01', isActive: true },
      },
    })
    expect(screen.getByText('Invite pending')).toBeInTheDocument()
    expect(screen.queryByText('No account')).not.toBeInTheDocument()
  })

  it('puts Invite and Remove in the More actions menu', async () => {
    const { onInvite } = renderRow({ member: manual, canInvite: true, canRemove: true })

    const trigger = screen.getByRole('button', { name: 'More actions: Mari' })
    await userEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Invite to join', 'Remove member'])

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Invite to join' }))
    expect(onInvite).toHaveBeenCalledWith(manual, trigger)
  })

  it('offers only the actions the viewer may take', async () => {
    renderRow({ member: manual, canInvite: false, canRemove: true })

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Mari' }))
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Remove member'])
  })

  // The confirm dialog opens from a menu item that has unmounted by the time it
  // closes; without the hand-back focus falls to the body (CLAUDE.md → Focus
  // management).
  it('returns focus to the menu trigger when the remove dialog closes', async () => {
    renderRow({ member: manual, canRemove: true })

    const trigger = screen.getByRole('button', { name: 'More actions: Mari' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove member' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('hands focus to the list once a confirmed remove has closed the dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        ),
    )
    const { onRemove, onRemoveFocus } = renderRow({ member: manual, canRemove: true })

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Mari' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove member' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(onRemoveFocus).toHaveBeenCalledOnce())
    expect(onRemove).toHaveBeenCalledWith('member-2')
    vi.unstubAllGlobals()
  })
})

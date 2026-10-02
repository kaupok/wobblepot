import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberList } from './MemberList'
import { createQueryWrapper } from '@/test/query-wrapper'

vi.stubGlobal('fetch', vi.fn())

function mockMembers(members: unknown[] = []) {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ members }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function renderList(isOwner = true) {
  return render(<MemberList isOwner={isOwner} currentMemberId="member-123" />, createQueryWrapper())
}

describe('MemberList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMembers()
  })

  /**
   * `/household` supplies the `<h1>` (`src/app/household/page.tsx`) and this
   * card's title is the `<h2>` directly under it — hence `variant="section" as="h2"`
   * at `MemberList.tsx:78`, where the variant sets the size and `as` sets the
   * outline level. See HON-607, HON-618 and HON-781.
   *
   * Asserting the tag matters because nothing else can: axe renders this
   * component standalone in Storybook, where its title is the *first* heading
   * on the page, and `heading-order` never flags a lone first heading whatever
   * its level. Drop the `as` and the component keeps passing every gate while
   * `/household` ships an h1 → h4 skip.
   */
  it('renders its title one level below the page h1', async () => {
    renderList()

    expect(await screen.findByRole('heading', { name: 'Members', level: 2 })).toBeInTheDocument()
  })

  // The page h1 is the one Title on `/household`; this column title sits a size
  // below it at Section (HON-781).
  it('renders its title at the Section size, not the Title size', async () => {
    renderList()

    const title = await screen.findByRole('heading', { name: 'Members', level: 2 })
    expect(title).toHaveClass('text-base', 'font-semibold')
    expect(title).not.toHaveClass('text-xl')
  })

  it('renders the empty state when the household has no members', async () => {
    renderList()

    expect(await screen.findByText('No members found.')).toBeInTheDocument()
  })

  it('shows the failure copy when the roster request fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 500 }))

    renderList()

    expect(await screen.findByText('Failed to load members')).toBeInTheDocument()
  })

  // "Actions sit on the title row" (docs/DESIGN.md): Add member shares the
  // heading's row, and no tagline sits under the heading (HON-960).
  it('puts Add member on the title row for the owner', async () => {
    renderList()

    const title = await screen.findByRole('heading', { name: 'Members', level: 2 })
    expect(title.parentElement).toContainElement(screen.getByRole('button', { name: 'Add member' }))
    expect(title.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add member' }))
  })

  it('offers a member no Add member button', async () => {
    renderList(false)

    await screen.findByRole('heading', { name: 'Members', level: 2 })
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()
  })

  it('renders the members as a list of rows', async () => {
    mockMembers([
      {
        id: 'member-123',
        userId: 'user-123',
        name: 'Kaupo',
        role: 'owner',
        joinedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-123', name: 'Kaupo', email: 'k@example.com', image: null },
        preferences: null,
        invite: null,
      },
    ])
    renderList()

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Kaupo')
  })

  // The edit dialog opens from state, with no trigger to hand focus back to
  // (CLAUDE.md → Focus management).
  it('returns focus to the member name when the edit dialog closes', async () => {
    mockMembers([
      {
        id: 'member-123',
        userId: 'user-123',
        name: 'Kaupo',
        role: 'owner',
        joinedAt: '2026-01-01T00:00:00.000Z',
        user: { id: 'user-123', name: 'Kaupo', email: 'k@example.com', image: null },
        preferences: null,
        invite: null,
      },
    ])
    renderList()

    const name = await screen.findByRole('button', { name: 'Kaupo' })
    await userEvent.click(name)
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(name).toHaveFocus())
  })

  // The invite dialog unmounts as it closes; the menu item that opened it is
  // long gone, so focus goes back to the row's ⋯ trigger.
  it('returns focus to the More actions trigger when the invite dialog closes', async () => {
    mockMembers([
      {
        id: 'member-456',
        userId: null,
        name: 'Mari',
        role: 'member',
        joinedAt: '2026-01-01T00:00:00.000Z',
        user: null,
        preferences: null,
        invite: null,
      },
    ])
    renderList()

    const trigger = await screen.findByRole('button', { name: 'More actions: Mari' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Invite to join' }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

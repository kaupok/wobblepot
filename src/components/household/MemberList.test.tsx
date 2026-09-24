import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})

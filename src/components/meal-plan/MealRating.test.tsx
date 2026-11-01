import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import { CookedRatingBadge, MealRatingInline } from './MealRating'

// Mock sonner
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('MealRatingInline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('renders thumbs up and down buttons', () => {
    render(<MealRatingInline planId="plan-1" entryId="entry-1" rating={null} />, {
      wrapper: createQueryWrapper().wrapper,
    })

    expect(screen.getByRole('button', { name: 'Thumbs up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toBeInTheDocument()
  })

  it('shows active state for selected rating', () => {
    render(<MealRatingInline planId="plan-1" entryId="entry-1" rating="up" />, {
      wrapper: createQueryWrapper().wrapper,
    })

    const upButton = screen.getByRole('button', { name: 'Thumbs up' })
    expect(upButton).toHaveAttribute('aria-pressed', 'true')

    const downButton = screen.getByRole('button', { name: 'Thumbs down' })
    expect(downButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls API and onRatingChange when rating', async () => {
    const onRatingChange = vi.fn()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    render(
      <MealRatingInline
        planId="plan-1"
        entryId="entry-1"
        rating={null}
        onRatingChange={onRatingChange}
      />,
      { wrapper: createQueryWrapper().wrapper },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    expect(onRatingChange).toHaveBeenCalledWith('up')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ rating: 'up' }),
      }),
    )
  })

  it('toggles off when same rating clicked', async () => {
    const onRatingChange = vi.fn()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    render(
      <MealRatingInline
        planId="plan-1"
        entryId="entry-1"
        rating="up"
        onRatingChange={onRatingChange}
      />,
      { wrapper: createQueryWrapper().wrapper },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    expect(onRatingChange).toHaveBeenCalledWith(null)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        body: JSON.stringify({ rating: null }),
      }),
    )
  })

  it('reverts the optimistic rating and toasts when the save fails', async () => {
    const onRatingChange = vi.fn()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server prose' }),
    } as Response)

    render(
      <MealRatingInline
        planId="plan-1"
        entryId="entry-1"
        rating="down"
        onRatingChange={onRatingChange}
      />,
      { wrapper: createQueryWrapper().wrapper },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save rating'))
    expect(onRatingChange.mock.calls).toEqual([['up'], ['down']])
  })
})

describe('CookedRatingBadge', () => {
  const ok = { ok: true, json: () => Promise.resolve({}) } as Response

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  function renderBadge(
    props: Partial<React.ComponentProps<typeof CookedRatingBadge>> = {},
  ): ReturnType<typeof vi.fn> {
    const onRatingChange = vi.fn()
    render(
      <CookedRatingBadge
        planId="plan-1"
        entryId="entry-1"
        rating={null}
        onRatingChange={onRatingChange}
        {...props}
      />,
      { wrapper: createQueryWrapper().wrapper },
    )
    return onRatingChange
  }

  function patchBody() {
    return vi.mocked(global.fetch).mock.calls.map(([, init]) => init?.body)
  }

  it('shows Cooked and two unpressed thumbs when unrated', () => {
    renderBadge()

    expect(screen.getByText('Cooked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('rates up with {"rating":"up"}', async () => {
    vi.mocked(global.fetch).mockResolvedValue(ok)
    const onRatingChange = renderBadge()

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    expect(onRatingChange).toHaveBeenCalledWith('up')
    expect(patchBody()).toEqual(['{"rating":"up"}'])
  })

  it('clears the rating with {"rating":null} on a click on the chosen thumb', async () => {
    vi.mocked(global.fetch).mockResolvedValue(ok)
    const onRatingChange = renderBadge({ rating: 'up' })

    expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    expect(onRatingChange).toHaveBeenCalledWith(null)
    expect(patchBody()).toEqual(['{"rating":null}'])
  })

  it('switches an up rating to down with {"rating":"down"}', async () => {
    vi.mocked(global.fetch).mockResolvedValue(ok)
    const onRatingChange = renderBadge({ rating: 'up' })

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs down' }))

    expect(onRatingChange).toHaveBeenCalledWith('down')
    expect(patchBody()).toEqual(['{"rating":"down"}'])
  })

  it('reverts and toasts when the save fails', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server prose' }),
    } as Response)
    const onRatingChange = renderBadge()

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to save rating'))
    expect(onRatingChange.mock.calls).toEqual([['up'], [null]])
  })

  it('keeps the thumbs focusable but ignores a click while a save is pending', async () => {
    vi.mocked(global.fetch).mockReturnValue(new Promise(() => {}))
    renderBadge()

    const up = screen.getByRole('button', { name: 'Thumbs up' })
    await userEvent.click(up)

    await waitFor(() => expect(up).toHaveAttribute('aria-disabled', 'true'))
    expect(up).toBeEnabled()
    expect(up).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Thumbs down' }))
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('shows Cooked and the chosen thumb, with no buttons, when read-only', () => {
    renderBadge({ rating: 'up', isReadOnly: true })

    expect(screen.getByText('Cooked')).toBeInTheDocument()
    expect(screen.getByText('Thumbs up')).toBeInTheDocument()
    expect(screen.queryByText('Thumbs down')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the plain Cooked badge when read-only and unrated', () => {
    renderBadge({ isReadOnly: true })

    expect(screen.getByText('Cooked')).toBeInTheDocument()
    expect(screen.queryByText(/Thumbs/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

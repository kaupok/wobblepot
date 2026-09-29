import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealRatingPrompt, RatingBadge, MealRatingInline } from './MealRating'

// Mock sonner
vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('MealRatingPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('renders prompt text and buttons', () => {
    render(<MealRatingPrompt planId="plan-1" entryId="entry-1" />, {
      wrapper: createQueryWrapper().wrapper,
    })

    expect(screen.getByText('How was it?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thumbs up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Thumbs down' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss rating' })).toBeInTheDocument()
  })

  it('calls onRated with "up" when thumbs up clicked', async () => {
    const onRated = vi.fn()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    render(<MealRatingPrompt planId="plan-1" entryId="entry-1" onRated={onRated} />, {
      wrapper: createQueryWrapper().wrapper,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ rating: 'up' }),
      }),
    )
    expect(onRated).toHaveBeenCalledWith('up')
  })

  it('calls onRated with "down" when thumbs down clicked', async () => {
    const onRated = vi.fn()
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    render(<MealRatingPrompt planId="plan-1" entryId="entry-1" onRated={onRated} />, {
      wrapper: createQueryWrapper().wrapper,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Thumbs down' }))

    expect(onRated).toHaveBeenCalledWith('down')
  })

  it('calls onDismiss when dismiss button clicked', async () => {
    const onDismiss = vi.fn()

    render(<MealRatingPrompt planId="plan-1" entryId="entry-1" onDismiss={onDismiss} />, {
      wrapper: createQueryWrapper().wrapper,
    })

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss rating' }))

    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('RatingBadge', () => {
  it('renders thumbs up badge', () => {
    const { container } = render(<RatingBadge rating="up" />, {
      wrapper: createQueryWrapper().wrapper,
    })

    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders as clickable button when onClick provided', () => {
    const onClick = vi.fn()
    render(<RatingBadge rating="up" onClick={onClick} />, { wrapper: createQueryWrapper().wrapper })

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('renders without button when no onClick', () => {
    render(<RatingBadge rating="down" />, { wrapper: createQueryWrapper().wrapper })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

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

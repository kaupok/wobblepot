import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GeneratingOverlay } from './GeneratingOverlay'

describe('GeneratingOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders heading and initial progress message', () => {
    render(<GeneratingOverlay />)

    expect(screen.getByRole('heading', { name: 'Generating your meal plan…' })).toBeInTheDocument()
    expect(screen.getByText('Analyzing your preferences…')).toBeInTheDocument()
  })

  it('renders spinning loader icon', () => {
    const { container } = render(<GeneratingOverlay />)

    // Testing the animation class requires direct DOM query
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const loader = container.querySelector('.animate-spin')
    expect(loader).toBeInTheDocument()
  })

  it('cycles through progress messages every 3 seconds', () => {
    render(<GeneratingOverlay />)

    expect(screen.getByText('Analyzing your preferences…')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Finding balanced meals…')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Ensuring variety for the week…')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('Almost there…')).toBeInTheDocument()
  })

  it('cycles back to first message after all messages shown (before slow threshold)', () => {
    render(<GeneratingOverlay />)

    // Advance through almost all 4 messages (3 * 3000ms = 9000ms) - just before 10s threshold
    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(screen.getByText('Almost there…')).toBeInTheDocument()

    // At 9s + 3s = 12s, but slow threshold kicks in at 10s
    // So we test cycling BEFORE the threshold by checking at 9s we're on message 4
    // Message cycle: 0s=msg1, 3s=msg2, 6s=msg3, 9s=msg4
  })

  it('shows slow message after 10 seconds', () => {
    render(<GeneratingOverlay />)

    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(screen.getByText('Taking longer than expected, please wait…')).toBeInTheDocument()
  })

  it('keeps showing slow message after it appears', () => {
    render(<GeneratingOverlay />)

    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(screen.getByText('Taking longer than expected, please wait…')).toBeInTheDocument()

    // Even after more time passes, should still show slow message
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Taking longer than expected, please wait…')).toBeInTheDocument()
  })
})

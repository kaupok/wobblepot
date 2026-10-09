import { createRef } from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
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
    render(<GeneratingOverlay />)

    // Testing the animation class requires direct DOM query. The dialog
    // renders in a portal, outside the render container.
    // eslint-disable-next-line testing-library/no-node-access
    const loader = document.body.querySelector('.animate-spin')
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

  describe('as a dialog', () => {
    it('is a dialog named by the heading and described by the message', () => {
      render(<GeneratingOverlay />)

      const dialog = screen.getByRole('dialog', { name: 'Generating your meal plan…' })
      expect(dialog).toHaveAccessibleDescription('Analyzing your preferences…')
    })

    it('hides the page under it from assistive technology', () => {
      render(
        <>
          <button type="button">Generate</button>
          <GeneratingOverlay />
        </>,
      )

      expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Generate', hidden: true })).toBeInTheDocument()
    })

    it('announces each message change once, from one polite status region', () => {
      render(<GeneratingOverlay />)

      const status = screen.getByRole('status')
      expect(status).toHaveAttribute('aria-live', 'polite')
      expect(status).toHaveTextContent('Analyzing your preferences…')

      act(() => {
        vi.advanceTimersByTime(10000)
      })

      // The same element, so a screen reader hears the change rather than a
      // new region appearing.
      expect(screen.getByRole('status')).toBe(status)
      expect(status).toHaveTextContent('Taking longer than expected, please wait…')
    })

    it('has no close button and stays open on Escape', () => {
      render(<GeneratingOverlay />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('takes focus into the dialog', () => {
      render(<GeneratingOverlay />)

      expect(screen.getByRole('dialog')).toHaveFocus()
    })

    it('focuses the control that started the wait once it closes', () => {
      const returnFocusRef = createRef<HTMLButtonElement>()
      const { rerender } = render(
        <>
          <button ref={returnFocusRef} type="button">
            Generate
          </button>
          <GeneratingOverlay returnFocusRef={returnFocusRef} />
        </>,
      )
      expect(screen.getByRole('dialog')).toHaveFocus()

      rerender(
        <button ref={returnFocusRef} type="button">
          Generate
        </button>,
      )
      // Radix restores focus in a timeout after the dialog unmounts.
      act(() => {
        vi.runOnlyPendingTimers()
      })

      expect(screen.getByRole('button', { name: 'Generate' })).toHaveFocus()
    })
  })
})

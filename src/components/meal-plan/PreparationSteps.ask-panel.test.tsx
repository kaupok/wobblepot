import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparationSteps, type CookQuestionControls } from './PreparationSteps'
import type { CookQuestionActive } from '@/hooks/use-cook-question'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'
import {
  Harness,
  buttonName,
  card,
  menuButton,
  openPanel,
  panel,
  pick,
  sampleTips,
  scrollIntoView,
  step,
  stubScrollIntoView,
} from './PreparationSteps.ask.fixtures'

// The steps' cook question panel: its reading order, focus and scrolling.
describe('PreparationSteps cook question panel', () => {
  stubScrollIntoView()

  describe('reads in the order things happen (HON-1022)', () => {
    /** Each element's position in the document, to compare reading order. */
    const inOrder = (...els: HTMLElement[]) =>
      els.every(
        (el, i) =>
          i === 0 || els[i - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
      )

    it('before a question: Close alone in the top row, then the field with Send', async () => {
      render(<Harness />)
      await openPanel(1)
      const p = within(panel(1)!)
      const field = p.getByRole('textbox')
      const send = p.getByRole('button', { name: 'Send' })
      const close = p.getByRole('button', { name: 'Close' })
      expect(inOrder(close, field, send)).toBe(true)
      // × has the top row to itself, so the field keeps the card's width.
      expect(close.parentElement).not.toContainElement(field)
      expect(close.parentElement?.lastElementChild).toBe(close)
      expect(field).toHaveAttribute('placeholder', 'Ask about this step')
    })

    it('after a question: the question with Edit and Close, the answer, then the follow-up field, with no chips', async () => {
      const active = { subject: step(0), question: 'No cream, what now?', answer: null }
      const states: Partial<CookQuestionControls>[] = [
        { active, isPending: true },
        { active: { ...active, answer: 'Use the yoghurt you have.' } },
        { active, error: { message: 'Took too long.', canRetry: true } },
      ]
      for (const controls of states) {
        const { unmount } = render(<Harness open={step(0)} controls={controls} />)
        const p = within(panel(1)!)
        const line = p.getByText('You asked: No cream, what now?')
        // While pending, "Thinking…" holds the pencil's place (HON-978).
        const edit = controls.isPending
          ? p.getByText('Thinking…', { selector: 'p' })
          : p.getByRole('button', { name: 'Edit question' })
        const status = p.getByRole('status')
        const field = p.getByRole('textbox')
        const close = p.getByRole('button', { name: 'Close' })
        expect(inOrder(line, edit, close, status, field)).toBe(true)
        expect(field).toHaveAttribute('placeholder', 'Ask a follow-up')
        expect(p.queryByRole('button', { name: "How do I know it's done?" })).toBeNull()
        // The top row: the question, the pencil, then × at its end, the
        // card's top-right, in every state (HON-1371).
        const row = close.parentElement!
        expect(row).toContainElement(line)
        expect(row).toContainElement(edit)
        expect(row.lastElementChild).toBe(close)
        // No footer: nothing follows Send.
        expect(p.getByRole('button', { name: 'Send' }).nextElementSibling).toBeNull()
        unmount()
      }
    })

    it('shows "Thinking…" in the top row in the pencil’s place, and Retry under the error', async () => {
      const active = { subject: step(0), question: 'Q', answer: null }
      const { unmount } = render(<Harness open={step(0)} controls={{ active, isPending: true }} />)
      const thinking = within(card()!).getByText('Thinking…', { selector: 'p' })
      const close = screen.getByRole('button', { name: 'Close' })
      expect(close.parentElement).toContainElement(thinking)
      expect(screen.queryByRole('button', { name: 'Edit question' })).toBeNull()
      unmount()

      render(
        <Harness controls={{ active, error: { message: 'Took too long.', canRetry: true } }} />,
      )
      await openPanel(1)
      const retry = within(card()!).getByRole('button', { name: 'Retry' })
      expect(inOrder(screen.getByText('Took too long.'), retry, screen.getByRole('textbox'))).toBe(
        true,
      )
    })

    it('holds the panel in one borderless rounded card on the chip colour (HON-1371)', async () => {
      render(
        <Harness
          controls={{ active: { subject: step(0), question: 'Q', answer: 'Use the yoghurt.' } }}
        />,
      )
      await openPanel(1)
      const box = card()!
      expect(box).toHaveClass('rounded-xl', 'bg-secondary/50')
      expect(box).not.toHaveClass('border')
      for (const el of [
        screen.getByText('You asked: Q'),
        screen.getByText('Use the yoghurt.'),
        screen.getByRole('textbox'),
        screen.getByRole('button', { name: 'Send' }),
      ]) {
        expect(box).toContainElement(el)
      }
    })

    it('makes Edit a pencil and Close a ×, both 44px icon buttons', async () => {
      render(<Harness controls={{ active: { subject: step(0), question: 'Q', answer: 'A.' } }} />)
      await openPanel(1)
      for (const name of ['Edit question', 'Close']) {
        const button = screen.getByRole('button', { name })
        expect(button).toHaveAttribute('data-size', 'icon-lg')
        expect(button).toHaveTextContent('')
        expect(button.querySelector('svg')).not.toBeNull()
      }
    })

    it('sets the question and the answer one size below the step text', async () => {
      render(
        <Harness
          controls={{ active: { subject: step(0), question: 'Q', answer: 'Use the yoghurt.' } }}
        />,
      )
      await openPanel(1)
      expect(screen.getByText('You asked: Q')).toHaveClass('text-base', 'lg:text-lg')
      expect(screen.getByText('Use the yoghurt.')).toHaveClass('text-base', 'lg:text-lg')
      // The step text, for comparison.
      expect(screen.getByText('Chop vegetables')).toHaveClass('text-lg', 'lg:text-xl')
    })

    it('gives the field and Send one size', async () => {
      render(<Harness />)
      await openPanel(1)
      const p = within(panel(1)!)
      expect(p.getByRole('textbox')).toHaveAttribute('data-size', 'lg')
      expect(p.getByRole('button', { name: 'Send' })).toHaveAttribute('data-size', 'lg')
    })

    it('a ready-made question moves focus to the × Close, never the field', async () => {
      // The modal's side with a question that goes out when the menu sends it.
      function Asking() {
        const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
        const [active, setActive] = useState<CookQuestionActive | null>(null)
        return (
          <PreparationSteps
            steps={sampleTips}
            isLoading={false}
            error={null}
            onRetry={vi.fn()}
            onToggleStep={vi.fn()}
            cookQuestion={{
              openSubject,
              onOpenSubject: setOpenSubject,
              onClose: () => {
                setOpenSubject(null)
                setActive(null)
              },
              ask: ({ subject, question }) => setActive({ subject, question, answer: null }),
              active,
              previous: null,
              isPending: active !== null,
              isStreaming: false,
              error: null,
              onRetry: vi.fn(),
            }}
          />
        )
      }
      render(<Asking />)
      await pick(menuButton(2), 'What can I substitute here?')

      expect(
        within(panel(2)!).getByText('You asked: What can I substitute here?'),
      ).toBeInTheDocument()
      const close = within(panel(2)!).getByRole('button', { name: 'Close' })
      await waitFor(() => expect(close).toHaveFocus())
      expect(within(panel(2)!).getByRole('textbox')).not.toHaveFocus()

      // Closing discards the question, and the panel never shows chips.
      await userEvent.click(close)
      await openPanel(2)
      expect(within(panel(2)!).queryByText(/You asked/)).toBeNull()
      expect(within(panel(2)!).getAllByRole('button').map(buttonName)).toEqual(['Close', 'Send'])
    })

    it('keeps the open ⋯ button ghost, marked only by aria-expanded (HON-1371)', async () => {
      render(<Harness />)
      await openPanel(2)
      expect(menuButton(2)).toHaveAttribute('aria-expanded', 'true')
      expect(menuButton(2)).toHaveAttribute('data-variant', 'ghost')
      expect(menuButton(2)).not.toHaveClass('bg-secondary')
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(menuButton(2)).toHaveAttribute('aria-expanded', 'false')
    })

    it('ends the steps’ ⋯ buttons and panel at the column’s right edge, as in “You’ll need”', async () => {
      render(<Harness />)
      await openPanel(1)
      // The row bleeds left past the numerals, never right.
      const list = menuButton(1).closest('ol')!
      expect(list.parentElement).toHaveClass('-ml-3')
      expect(list.parentElement).not.toHaveClass('-mx-3')
      expect(panel(1)).not.toHaveClass('pr-3')
    })
  })

  it('Close returns focus to that step’s ⋯ button', async () => {
    render(<Harness />)
    await openPanel(3)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(panel(3)).toBeNull()
    expect(menuButton(3)).toHaveFocus()
  })

  it('Escape in the field closes the panel and returns focus to the ⋯ button', async () => {
    render(<Harness />)
    await openPanel(2)
    await userEvent.click(screen.getByRole('textbox'))
    await userEvent.keyboard('{Escape}')

    expect(panel(2)).toBeNull()
    expect(menuButton(2)).toHaveFocus()
  })

  describe('keeps the panel and the answer in view (HON-977)', () => {
    const result = () => within(panel(1)!).getByRole('status').parentElement
    const scrolled = () => scrollIntoView.mock.contexts

    it('scrolls the panel into view, nearest and smooth, when it opens', async () => {
      render(<Harness />)
      await openPanel(1)

      expect(scrollIntoView).toHaveBeenCalledOnce()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
      expect(scrolled()[0]).toBe(panel(1))
    })

    it('scrolls the answer and the field into view when the answer arrives, and leaves focus', async () => {
      const active = { subject: step(0), question: "I'm short on time", answer: null }
      const { rerender } = render(<Harness open={step(0)} controls={{ active, isPending: true }} />)
      const close = screen.getByRole('button', { name: 'Close' })
      close.focus()
      // "Thinking…" does not scroll: only the open did.
      expect(scrolled()).toEqual([panel(1)])

      rerender(<Harness controls={{ active: { ...active, answer: 'Skip the rest.' } }} />)

      expect(scrolled()).toEqual([panel(1), result()])
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' })
      expect(result()).toContainElement(screen.getByText('Skip the rest.'))
      expect(result()).toContainElement(screen.getByRole('textbox'))
      expect(close).toHaveFocus()
    })

    it('scrolls at the first words and when the stream closes, not at every chunk (HON-979)', async () => {
      const active = { subject: step(0), question: "I'm short on time", answer: null }
      const { rerender } = render(<Harness open={step(0)} controls={{ active, isPending: true }} />)

      const streaming = (answer: string) => (
        <Harness controls={{ active: { ...active, answer }, isStreaming: true }} />
      )
      rerender(streaming('Skip '))
      rerender(streaming('Skip the '))
      rerender(streaming('Skip the rest.'))
      expect(scrolled()).toEqual([panel(1), result()])

      rerender(<Harness controls={{ active: { ...active, answer: 'Skip the rest.' } }} />)
      expect(scrolled()).toEqual([panel(1), result(), result()])
    })

    it('scrolls the error and Retry into view when the error arrives', async () => {
      const { rerender } = render(<Harness controls={{ isPending: true }} />)
      await openPanel(1)

      rerender(<Harness controls={{ error: { message: 'Took too long.', canRetry: true } }} />)

      expect(scrolled()).toEqual([panel(1), result()])
      expect(result()).toContainElement(screen.getByRole('button', { name: 'Retry' }))
    })

    it('snaps instead of scrolling smoothly under reduced motion', async () => {
      document.documentElement.setAttribute('data-reduced-motion', 'true')
      render(<Harness />)
      await openPanel(1)

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
    })
  })
})

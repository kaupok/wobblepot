import { useState } from 'react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PreparationEquipment,
  PreparationSteps,
  type CookQuestionControls,
} from './PreparationSteps'
import type { PreparationSteps as PreparationStepsData } from '@/components/meal-plan/types'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'
import type { CookQuestionActive } from '@/hooks/use-cook-question'

const sampleTips: PreparationStepsData = {
  equipment: ['Large pan', 'Cutting board'],
  steps: ['Chop vegetables', 'Heat oil in pan', 'Cook for 10 minutes'],
  pitfalls: ['Do not overcook the chicken', 'Season before cooking'],
  tip: 'Let the meat rest for 5 minutes before serving.',
}

/** A step as the subject of a cook question (HON-983) */
function step(index: number): CookQuestionSubject {
  return { kind: 'step', index }
}

describe('PreparationEquipment', () => {
  it('lists each item on its own row under the heading', () => {
    render(<PreparationEquipment equipment={sampleTips.equipment} />)
    // The same level as Steps, Watch out and Tip (HON-966).
    expect(screen.getByRole('heading', { level: 3, name: "You'll need" })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: "You'll need" })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['Large pan', 'Cutting board'])
  })

  it('renders nothing without equipment', () => {
    const { container } = render(<PreparationEquipment equipment={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('PreparationSteps', () => {
  describe('loading state', () => {
    it('renders the step skeleton and the Watch out heading', () => {
      render(<PreparationSteps steps={null} isLoading={true} error={null} onRetry={vi.fn()} />)
      expect(screen.getByTestId('preparation-steps-loading')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Watch out' })).toBeInTheDocument()
    })

    it('shows user notes above the skeleton when notes exist', () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={true}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Use extra garlic"
        />,
      )
      const notesHeading = screen.getByRole('heading', { name: 'Your notes' })
      expect(screen.getByText('Use extra garlic')).toBeInTheDocument()
      expect(
        notesHeading.compareDocumentPosition(screen.getByTestId('preparation-steps-loading')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })
  })

  describe('error state', () => {
    it('renders the error message with a retry button', () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={false}
          error="Failed to load tips"
          onRetry={vi.fn()}
        />,
      )
      expect(screen.getByText('Failed to load tips')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })

    it('calls onRetry when retry button is clicked', async () => {
      const user = userEvent.setup()
      const onRetry = vi.fn()
      render(
        <PreparationSteps
          steps={null}
          isLoading={false}
          error="Failed to load"
          onRetry={onRetry}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(onRetry).toHaveBeenCalledOnce()
    })

    it('shows user notes alongside the error when notes exist', () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={false}
          error="Failed to load"
          onRetry={vi.fn()}
          preparationNotes="My notes here"
        />,
      )
      expect(screen.getByRole('heading', { name: 'Your notes' })).toBeInTheDocument()
      expect(screen.getByText('My notes here')).toBeInTheDocument()
    })
  })

  describe('loaded state', () => {
    it('returns null when no tips and no notes', () => {
      const { container } = render(
        <PreparationSteps steps={null} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('shows only user notes when tips are null but notes exist', () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Cook slowly"
        />,
      )
      expect(screen.getByRole('heading', { name: 'Your notes' })).toBeInTheDocument()
      expect(screen.getByText('Cook slowly')).toBeInTheDocument()
    })

    it('leaves the equipment to PreparationEquipment', () => {
      render(
        <PreparationSteps steps={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(screen.queryByText(/Large pan/)).not.toBeInTheDocument()
    })

    it('renders the steps as an ordered list, in order', () => {
      render(
        <PreparationSteps steps={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      const list = screen.getAllByRole('list')[0]!
      expect(list.tagName).toBe('OL')
      const items = within(list).getAllByRole('listitem')
      expect(items.map((item) => item.textContent)).toEqual([
        '1Chop vegetables',
        '2Heat oil in pan',
        '3Cook for 10 minutes',
      ])
    })

    it('renders pitfalls under Watch out', () => {
      render(
        <PreparationSteps steps={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(screen.getByRole('heading', { name: 'Watch out' })).toBeInTheDocument()
      expect(screen.getByText('Do not overcook the chicken')).toBeInTheDocument()
      expect(screen.getByText('Season before cooking')).toBeInTheDocument()
    })

    it('renders the tip under Tip', () => {
      render(
        <PreparationSteps steps={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(screen.getByRole('heading', { name: 'Tip' })).toBeInTheDocument()
      expect(
        screen.getByText('Let the meat rest for 5 minutes before serving.'),
      ).toBeInTheDocument()
    })

    it('puts the household notes ahead of the generated steps', () => {
      render(
        <PreparationSteps
          steps={sampleTips}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Double the garlic"
        />,
      )
      expect(
        screen
          .getByText('Double the garlic')
          .compareDocumentPosition(screen.getByText('Chop vegetables')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('hides sections when they are empty', () => {
      const minimalTips: PreparationStepsData = {
        pitfalls: ['Watch the heat'],
      }
      const { container } = render(
        <PreparationSteps steps={minimalTips} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(screen.queryByRole('heading', { name: 'Tip' })).not.toBeInTheDocument()
      expect(container.querySelector('ol')).toBeNull()
      expect(screen.getByRole('heading', { name: 'Watch out' })).toBeInTheDocument()
    })
  })
})

// The cook view's steps are toggles: tap to mark done, the first one not done
// is the current one (HON-933).
describe('PreparationSteps progress', () => {
  function renderSteps(doneSteps: Set<number>, onToggleStep = vi.fn()) {
    render(
      <PreparationSteps
        steps={sampleTips}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        doneSteps={doneSteps}
        onToggleStep={onToggleStep}
      />,
    )
    return onToggleStep
  }
  const step = (name: string) => screen.getByRole('button', { name })

  it('renders each step as a toggle, the first one current', () => {
    renderSteps(new Set())
    expect(step('Chop vegetables')).toHaveAttribute('aria-pressed', 'false')
    expect(step('Chop vegetables')).toHaveAttribute('data-current')
    expect(step('Heat oil in pan')).not.toHaveAttribute('data-current')
  })

  it('marks done steps pressed and muted, and moves current to the next', () => {
    renderSteps(new Set([0]))
    expect(step('Chop vegetables')).toHaveAttribute('aria-pressed', 'true')
    expect(within(step('Chop vegetables')).getByText('Chop vegetables')).toHaveClass(
      'text-muted-foreground',
    )
    expect(step('Chop vegetables')).not.toHaveAttribute('data-current')
    expect(step('Heat oil in pan')).toHaveAttribute('data-current')
  })

  it('highlights nothing once every step is done', () => {
    const { container } = render(
      <PreparationSteps
        steps={sampleTips}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        doneSteps={new Set([0, 1, 2])}
        onToggleStep={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-current]')).toBeNull()
  })

  it('reports the tapped step by index', async () => {
    const onToggleStep = renderSteps(new Set())
    await userEvent.click(step('Heat oil in pan'))
    expect(onToggleStep).toHaveBeenCalledWith(1)
  })

  it('keeps the household’s own notes as plain text', () => {
    render(
      <PreparationSteps
        steps={sampleTips}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        preparationNotes="Use extra garlic"
        onToggleStep={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Use extra garlic' })).toBeNull()
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(3)
  })

  it('says the steps are being written while loading', () => {
    render(<PreparationSteps steps={null} isLoading={true} error={null} onRetry={vi.fn()} />)
    expect(screen.getByText('Writing the steps…')).toBeInTheDocument()
  })
})

// Each generated step gets an Ask button beside its toggle (HON-969).
describe('PreparationSteps cook question', () => {
  // jsdom has no scrollIntoView; the panel calls it on open and on arrival.
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
    document.documentElement.removeAttribute('data-reduced-motion')
  })

  /** The modal's side of the contract: one open step, held in state. */
  function Harness({
    controls = {},
  }: {
    controls?: Partial<Omit<CookQuestionControls, 'openSubject' | 'onOpenSubject' | 'onClose'>>
  }) {
    const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
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
          onClose: () => setOpenSubject(null),
          ask: vi.fn(),
          active: null,
          previous: null,
          isPending: false,
          isStreaming: false,
          error: null,
          onRetry: vi.fn(),
          ...controls,
        }}
      />
    )
  }
  const askButton = (n: number) => screen.getByRole('button', { name: `Ask about step ${n}` })
  const panel = (n: number) => screen.queryByRole('group', { name: `Ask about step ${n}` })

  it('renders an Ask button per step only with cookQuestion', () => {
    const { unmount } = render(<Harness />)
    expect(askButton(1)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('button', { name: /^Ask about step/ })).toHaveLength(3)
    unmount()

    render(
      <PreparationSteps
        steps={sampleTips}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onToggleStep={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Ask about step/ })).toBeNull()
  })

  it('labels the Ask button "Ask" for lg, keeps the step in its name, and sets no title', () => {
    render(<Harness />)
    const button = askButton(2)
    expect(within(button).getByText('Ask')).toHaveClass('hidden', 'lg:inline')
    expect(button).not.toHaveAttribute('title')
  })

  it('shows no Ask button on the static numbered list', () => {
    render(<PreparationSteps steps={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Ask about step/ })).toBeNull()
  })

  it('opens a panel with three chips and a field, and one panel at a time', async () => {
    render(<Harness />)
    await userEvent.click(askButton(1))

    const first = panel(1)!
    expect(askButton(1)).toHaveAttribute('aria-expanded', 'true')
    expect(within(first).getByRole('button', { name: "How do I know it's done?" })).toBeVisible()
    expect(within(first).getByRole('button', { name: 'What can I substitute here?' })).toBeVisible()
    expect(within(first).getByRole('button', { name: "I'm short on time" })).toBeVisible()
    expect(within(first).getByRole('textbox', { name: 'Your question' })).toBeVisible()

    await userEvent.click(askButton(2))
    expect(panel(1)).toBeNull()
    expect(panel(2)).not.toBeNull()
    // Switching moves focus into the new panel's field.
    expect(within(panel(2)!).getByRole('textbox')).toHaveFocus()
  })

  it('a chip sends its text, the steps and source chip', async () => {
    const ask = vi.fn()
    render(<Harness controls={{ ask }} />)
    await userEvent.click(askButton(2))
    await userEvent.click(screen.getByRole('button', { name: 'What can I substitute here?' }))

    expect(ask).toHaveBeenCalledWith({
      subject: step(1),
      steps: sampleTips.steps,
      equipment: sampleTips.equipment,
      question: 'What can I substitute here?',
      source: 'chip',
    })
  })

  it('Enter in the field sends the typed question with source text', async () => {
    const ask = vi.fn()
    render(<Harness controls={{ ask }} />)
    await userEvent.click(askButton(1))
    await userEvent.type(screen.getByRole('textbox'), '  No cream, what now?  {Enter}')

    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith({
      subject: step(0),
      steps: sampleTips.steps,
      equipment: sampleTips.equipment,
      question: 'No cream, what now?',
      source: 'text',
    })
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('Send does nothing while an answer is pending, and keeps focus', async () => {
    const ask = vi.fn()
    render(<Harness controls={{ ask, isPending: true }} />)
    await userEvent.click(askButton(1))
    await userEvent.type(screen.getByRole('textbox'), 'Done yet?')
    const send = screen.getByRole('button', { name: 'Send' })
    await userEvent.click(send)

    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(send).not.toBeDisabled()
    expect(send).toHaveFocus()
    expect(ask).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
  })

  it('a chip does nothing while an answer is pending', async () => {
    const ask = vi.fn()
    render(<Harness controls={{ ask, isPending: true }} />)
    await userEvent.click(askButton(1))
    const chip = screen.getByRole('button', { name: "I'm short on time" })
    await userEvent.click(chip)

    expect(chip).toHaveAttribute('aria-disabled', 'true')
    expect(ask).not.toHaveBeenCalled()
  })

  it('Send does nothing while the answer streams in, and the chips are gone (HON-979)', async () => {
    const ask = vi.fn()
    render(
      <Harness
        controls={{
          ask,
          isStreaming: true,
          active: { subject: step(0), question: 'Q', answer: 'Use the ' },
        }}
      />,
    )
    await userEvent.click(askButton(1))
    await userEvent.type(screen.getByRole('textbox'), 'Done yet?')
    const send = screen.getByRole('button', { name: 'Send' })
    await userEvent.click(send)

    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: "I'm short on time" })).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it('marks the status busy while the answer streams, without "Thinking…"', async () => {
    const active = { subject: step(0), question: 'Q', answer: 'Use the ' }
    const { rerender } = render(<Harness controls={{ isStreaming: true, active }} />)
    await userEvent.click(askButton(1))
    const status = within(panel(1)!).getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent(/^Use the$/)

    rerender(<Harness controls={{ active: { ...active, answer: 'Use the yoghurt.' } }} />)
    expect(within(panel(1)!).getByRole('status')).toHaveAttribute('aria-busy', 'false')
  })

  it('keeps the words that arrived above the error when the stream broke', async () => {
    render(
      <Harness
        controls={{
          active: { subject: step(0), question: 'Q', answer: 'Use the ' },
          error: { message: 'Could not answer.', canRetry: true },
        }}
      />,
    )
    await userEvent.click(askButton(1))
    const status = within(panel(1)!).getByRole('status')
    const words = within(status).getByText('Use the')
    const error = within(status).getByText('Could not answer.')
    expect(words.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the answer for its own step', async () => {
    render(
      <Harness
        controls={{
          active: { subject: step(0), question: 'Q', answer: 'Use the yoghurt you have.' },
        }}
      />,
    )
    await userEvent.click(askButton(1))
    expect(within(panel(1)!).getByRole('status')).toHaveTextContent('Use the yoghurt you have.')
  })

  it('shows no asked question without an active question', async () => {
    render(<Harness />)
    await userEvent.click(askButton(1))
    expect(within(panel(1)!).queryByText(/^You asked:/)).toBeNull()
    expect(within(panel(1)!).queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('shows no asked question for another step’s question', async () => {
    render(
      <Harness
        controls={{ active: { subject: step(0), question: 'Done yet?', answer: 'Not yet.' } }}
      />,
    )
    await userEvent.click(askButton(2))
    expect(within(panel(2)!).queryByText(/^You asked:/)).toBeNull()
    expect(within(panel(2)!).queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('shows the asked question above the status, while pending, answered and failed', async () => {
    const active = { subject: step(0), question: 'No cream, what now?', answer: null }
    const states: Partial<CookQuestionControls>[] = [
      { active, isPending: true },
      { active: { ...active, answer: 'Use the yoghurt you have.' } },
      { active, error: { message: 'Took too long.', canRetry: true } },
    ]
    for (const controls of states) {
      const { unmount } = render(<Harness controls={controls} />)
      await userEvent.click(askButton(1))
      const line = within(panel(1)!).getByText('You asked: No cream, what now?')
      const status = within(panel(1)!).getByRole('status')
      expect(status).not.toContainElement(line)
      expect(line.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      unmount()
    }
  })

  it('keeps the last answer, muted under its own question, above "Thinking…" (HON-978)', async () => {
    render(
      <Harness
        controls={{
          active: { subject: step(0), question: "I'm short on time", answer: null },
          previous: {
            subject: step(0),
            question: 'No cream, what now?',
            answer: 'Use the yoghurt.',
          },
          isPending: true,
        }}
      />,
    )
    await userEvent.click(askButton(1))
    const status = within(panel(1)!).getByRole('status')
    const stale = within(status).getByText('Use the yoghurt.')
    expect(stale).toHaveClass('text-muted-foreground')
    expect(status).toHaveTextContent(/Thinking…$/)
    expect(within(panel(1)!).getByText('You asked: No cream, what now?')).toBeInTheDocument()
    expect(within(panel(1)!).queryByText("You asked: I'm short on time")).toBeNull()
  })

  it("shows no stale answer from another step's question", async () => {
    render(
      <Harness
        controls={{
          active: { subject: step(1), question: "I'm short on time", answer: null },
          previous: {
            subject: step(0),
            question: 'No cream, what now?',
            answer: 'Use the yoghurt.',
          },
          isPending: true,
        }}
      />,
    )
    await userEvent.click(askButton(2))
    const status = within(panel(2)!).getByRole('status')
    expect(status).toHaveTextContent(/^Thinking…$/)
    expect(within(panel(2)!).getByText("You asked: I'm short on time")).toBeInTheDocument()
  })

  it('Edit puts the question in the field with focus and the caret at the end, and does not send', async () => {
    const ask = vi.fn()
    render(
      <Harness
        controls={{
          ask,
          active: { subject: step(1), question: 'No cream, what now?', answer: 'A.' },
        }}
      />,
    )
    await userEvent.click(askButton(2))
    const edit = within(panel(2)!).getByRole('button', { name: 'Edit' })
    expect(edit).toHaveAccessibleDescription('You asked: No cream, what now?')
    await userEvent.click(edit)

    const field = screen.getByRole<HTMLInputElement>('textbox')
    expect(field).toHaveValue('No cream, what now?')
    expect(field).toHaveFocus()
    expect(field.selectionStart).toBe('No cream, what now?'.length)
    expect(field.selectionEnd).toBe('No cream, what now?'.length)
    expect(ask).not.toHaveBeenCalled()

    // Sending the edited text is a new typed question.
    await userEvent.type(field, ' Milk?{Enter}')
    expect(ask).toHaveBeenCalledWith({
      subject: step(1),
      steps: sampleTips.steps,
      equipment: sampleTips.equipment,
      question: 'No cream, what now? Milk?',
      source: 'text',
    })
  })

  it('Edit focuses the field again when the text is unchanged', async () => {
    render(
      <Harness
        controls={{ active: { subject: step(0), question: 'Done yet?', answer: 'Not yet.' } }}
      />,
    )
    await userEvent.click(askButton(1))
    const edit = screen.getByRole('button', { name: 'Edit' })
    await userEvent.click(edit)
    await userEvent.click(edit)
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('shows the error with Retry when a retry can help, and without it otherwise', async () => {
    const onRetry = vi.fn()
    const { unmount } = render(
      <Harness controls={{ error: { message: 'Took too long.', canRetry: true }, onRetry }} />,
    )
    await userEvent.click(askButton(1))
    expect(screen.getByRole('status')).toHaveTextContent('Took too long.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    // Retry leaves the page as the error clears: focus waits on Close.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    unmount()

    render(<Harness controls={{ error: { message: 'Limit reached.', canRetry: false } }} />)
    await userEvent.click(askButton(1))
    expect(screen.getByRole('status')).toHaveTextContent('Limit reached.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  describe('reads in the order things happen (HON-1022)', () => {
    /** Each element's position in the document, to compare reading order. */
    const inOrder = (...els: HTMLElement[]) =>
      els.every(
        (el, i) =>
          i === 0 || els[i - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
      )

    it('before a question: the chips, the field with Send, then Close', async () => {
      render(<Harness />)
      await userEvent.click(askButton(1))
      const p = within(panel(1)!)
      const chip = p.getByRole('button', { name: "How do I know it's done?" })
      const field = p.getByRole('textbox')
      const send = p.getByRole('button', { name: 'Send' })
      const close = p.getByRole('button', { name: 'Close' })
      expect(inOrder(chip, field, send, close)).toBe(true)
      expect(field).toHaveAttribute('placeholder', 'Ask about this step')
    })

    it('after a question: the question with Edit, the answer, the follow-up field, then Close, with no chips', async () => {
      const active = { subject: step(0), question: 'No cream, what now?', answer: null }
      const states: Partial<CookQuestionControls>[] = [
        { active, isPending: true },
        { active: { ...active, answer: 'Use the yoghurt you have.' } },
        { active, error: { message: 'Took too long.', canRetry: true } },
      ]
      for (const controls of states) {
        const { unmount } = render(<Harness controls={controls} />)
        await userEvent.click(askButton(1))
        const p = within(panel(1)!)
        const line = p.getByText('You asked: No cream, what now?')
        const edit = p.getByRole('button', { name: 'Edit' })
        const status = p.getByRole('status')
        const field = p.getByRole('textbox')
        const close = p.getByRole('button', { name: 'Close' })
        expect(inOrder(line, edit, status, field, close)).toBe(true)
        expect(field).toHaveAttribute('placeholder', 'Ask a follow-up')
        expect(p.queryByRole('button', { name: "How do I know it's done?" })).toBeNull()
        // Edit sits right after the question, not pushed to the row's end.
        expect(line.parentElement).not.toHaveClass('flex-1')
        expect(line.parentElement?.nextElementSibling).toBe(edit)
        // Close ends the footer row in every state, so it does not move.
        expect(close.parentElement?.lastElementChild).toBe(close)
        expect(close).toHaveClass('ml-auto')
        unmount()
      }
    })

    it('shows "Thinking…" and Retry in the footer row, before Close', async () => {
      const active = { subject: step(0), question: 'Q', answer: null }
      const { unmount } = render(<Harness controls={{ active, isPending: true }} />)
      await userEvent.click(askButton(1))
      const close = screen.getByRole('button', { name: 'Close' })
      const thinking = within(close.parentElement!).getByText('Thinking…')
      expect(inOrder(thinking, close)).toBe(true)
      unmount()

      render(
        <Harness controls={{ active, error: { message: 'Took too long.', canRetry: true } }} />,
      )
      await userEvent.click(askButton(1))
      const retry = screen.getByRole('button', { name: 'Retry' })
      expect(retry.parentElement).toBe(screen.getByRole('button', { name: 'Close' }).parentElement)
    })

    it('sets the question one size below the answer', async () => {
      render(
        <Harness
          controls={{ active: { subject: step(0), question: 'Q', answer: 'Use the yoghurt.' } }}
        />,
      )
      await userEvent.click(askButton(1))
      expect(screen.getByText('You asked: Q')).toHaveClass('text-base', 'lg:text-lg')
      expect(screen.getByText('Use the yoghurt.')).toHaveClass('text-lg', 'lg:text-xl')
    })

    it('gives the chips, the field and Send one size', async () => {
      render(<Harness />)
      await userEvent.click(askButton(1))
      const p = within(panel(1)!)
      expect(p.getByRole('button', { name: "I'm short on time" })).toHaveAttribute(
        'data-size',
        'lg',
      )
      expect(p.getByRole('textbox')).toHaveAttribute('data-size', 'lg')
      expect(p.getByRole('button', { name: 'Send' })).toHaveAttribute('data-size', 'lg')
    })

    it('a chip moves focus to Close as the chips give way to the question', async () => {
      // The modal's side with a question that goes out when a chip sends it.
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
      await userEvent.click(askButton(2))
      await userEvent.click(screen.getByRole('button', { name: 'What can I substitute here?' }))

      expect(screen.queryByRole('button', { name: 'What can I substitute here?' })).toBeNull()
      expect(screen.getByText('You asked: What can I substitute here?')).toBeInTheDocument()
      expect(document.body).not.toHaveFocus()
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

      // Closing discards the question, so the chips are back on the next open.
      await userEvent.click(screen.getByRole('button', { name: 'Close' }))
      await userEvent.click(askButton(2))
      expect(screen.getByRole('button', { name: 'What can I substitute here?' })).toBeVisible()
    })

    it('fills the Ask button whose panel is open, and no other', async () => {
      render(<Harness />)
      await userEvent.click(askButton(2))
      expect(askButton(2)).toHaveClass('bg-secondary')
      expect(askButton(1)).not.toHaveClass('bg-secondary')
      await userEvent.click(askButton(2))
      expect(askButton(2)).not.toHaveClass('bg-secondary')
    })

    it('ends the steps’ Ask buttons and panel at the column’s right edge, as in “You’ll need”', async () => {
      render(<Harness />)
      await userEvent.click(askButton(1))
      // The row bleeds left past the numerals, never right.
      const list = askButton(1).closest('ol')!
      expect(list.parentElement).toHaveClass('-ml-3')
      expect(list.parentElement).not.toHaveClass('-mx-3')
      expect(panel(1)).not.toHaveClass('pr-3')
    })
  })

  it('Close returns focus to that step’s Ask button', async () => {
    render(<Harness />)
    await userEvent.click(askButton(3))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(panel(3)).toBeNull()
    expect(askButton(3)).toHaveFocus()
  })

  it('Escape in the field closes the panel and returns focus to the Ask button', async () => {
    render(<Harness />)
    await userEvent.click(askButton(2))
    await userEvent.click(screen.getByRole('textbox'))
    await userEvent.keyboard('{Escape}')

    expect(panel(2)).toBeNull()
    expect(askButton(2)).toHaveFocus()
  })

  describe('keeps the panel and the answer in view (HON-977)', () => {
    const result = () => within(panel(1)!).getByRole('status').parentElement
    const scrolled = () => scrollIntoView.mock.contexts

    it('scrolls the panel into view, nearest and smooth, when it opens', async () => {
      render(<Harness />)
      await userEvent.click(askButton(1))

      expect(scrollIntoView).toHaveBeenCalledOnce()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
      expect(scrolled()[0]).toBe(panel(1))
    })

    it('scrolls the answer and Close into view when the answer arrives, and leaves focus', async () => {
      const active = { subject: step(0), question: "I'm short on time", answer: null }
      const { rerender } = render(<Harness controls={{ active, isPending: true }} />)
      await userEvent.click(askButton(1))
      const close = screen.getByRole('button', { name: 'Close' })
      close.focus()
      // "Thinking…" does not scroll: only the open did.
      expect(scrolled()).toEqual([panel(1)])

      rerender(<Harness controls={{ active: { ...active, answer: 'Skip the rest.' } }} />)

      expect(scrolled()).toEqual([panel(1), result()])
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' })
      expect(result()).toContainElement(close)
      expect(close).toHaveFocus()
    })

    it('scrolls at the first words and when the stream closes, not at every chunk (HON-979)', async () => {
      const active = { subject: step(0), question: "I'm short on time", answer: null }
      const { rerender } = render(<Harness controls={{ active, isPending: true }} />)
      await userEvent.click(askButton(1))

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
      await userEvent.click(askButton(1))

      rerender(<Harness controls={{ error: { message: 'Took too long.', canRetry: true } }} />)

      expect(scrolled()).toEqual([panel(1), result()])
      expect(result()).toContainElement(screen.getByRole('button', { name: 'Retry' }))
    })

    it('snaps instead of scrolling smoothly under reduced motion', async () => {
      document.documentElement.setAttribute('data-reduced-motion', 'true')
      render(<Harness />)
      await userEvent.click(askButton(1))

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
    })
  })
})

describe('PreparationEquipment cook question (HON-983)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  /** The modal's side: one open subject across "You'll need" and the steps. */
  function Harness({ ask = vi.fn() }: { ask?: CookQuestionControls['ask'] }) {
    const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
    const cookQuestion: CookQuestionControls = {
      openSubject,
      onOpenSubject: setOpenSubject,
      onClose: () => setOpenSubject(null),
      ask,
      active: null,
      previous: null,
      isPending: false,
      isStreaming: false,
      error: null,
      onRetry: vi.fn(),
    }
    return (
      <>
        <PreparationEquipment
          equipment={sampleTips.equipment}
          steps={sampleTips.steps}
          cookQuestion={cookQuestion}
        />
        <PreparationSteps
          steps={sampleTips}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          onToggleStep={vi.fn()}
          cookQuestion={cookQuestion}
        />
      </>
    )
  }
  const askItem = (item: string) => screen.getByRole('button', { name: `Ask about ${item}` })
  const itemPanel = (item: string) => screen.queryByRole('group', { name: `Ask about ${item}` })

  it('ends each row in an Ask button named for the item, only with cookQuestion', () => {
    const { unmount } = render(<Harness />)
    const list = screen.getByRole('list', { name: "You'll need" })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByRole('button', { name: 'Ask about Large pan' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(items[1]!).getByText('Cutting board')).toBeInTheDocument()
    expect(within(askItem('Cutting board')).getByText('Ask')).toHaveClass('hidden', 'lg:inline')
    unmount()

    render(<PreparationEquipment equipment={sampleTips.equipment} steps={sampleTips.steps} />)
    expect(screen.queryByRole('button', { name: /^Ask about/ })).toBeNull()
  })

  it('shows no Ask button without steps to send', () => {
    render(
      <PreparationEquipment
        equipment={sampleTips.equipment}
        steps={[]}
        cookQuestion={{
          openSubject: null,
          onOpenSubject: vi.fn(),
          onClose: vi.fn(),
          ask: vi.fn(),
          active: null,
          previous: null,
          isPending: false,
          isStreaming: false,
          error: null,
          onRetry: vi.fn(),
        }}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Ask about/ })).toBeNull()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Large pan',
      'Cutting board',
    ])
  })

  it('shows no Ask button on a row the route cannot answer about', () => {
    const equipment = ['  ', ...Array.from({ length: 20 }, (_, i) => `Pan ${i + 1}`)]
    render(
      <PreparationEquipment
        equipment={equipment}
        steps={sampleTips.steps}
        cookQuestion={{
          openSubject: null,
          onOpenSubject: vi.fn(),
          onClose: vi.fn(),
          ask: vi.fn(),
          active: null,
          previous: null,
          isPending: false,
          isStreaming: false,
          error: null,
          onRetry: vi.fn(),
        }}
      />,
    )
    // The empty row and the 21st row, past the route's 20, have none.
    expect(screen.getAllByRole('listitem')).toHaveLength(21)
    expect(screen.getAllByRole('button', { name: /^Ask about/ })).toHaveLength(19)
    expect(screen.getByRole('button', { name: 'Ask about Pan 19' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask about Pan 20' })).toBeNull()
  })

  it('opens a panel under the row with the equipment chips and placeholder', async () => {
    render(<Harness />)
    await userEvent.click(askItem('Cutting board'))

    const panel = itemPanel('Cutting board')!
    expect(askItem('Cutting board')).toHaveAttribute('aria-expanded', 'true')
    expect(askItem('Cutting board').closest('li')).toContainElement(panel)
    for (const chip of ['What can I use instead?', 'Does the size matter?', 'Can I skip it?']) {
      expect(within(panel).getByRole('button', { name: chip })).toBeVisible()
    }
    expect(within(panel).queryByRole('button', { name: "How do I know it's done?" })).toBeNull()
    expect(within(panel).getByRole('textbox', { name: 'Your question' })).toHaveAttribute(
      'placeholder',
      'Ask about this item',
    )
  })

  it('a chip sends the item as the subject, with the steps and the equipment', async () => {
    const ask = vi.fn()
    render(<Harness ask={ask} />)
    await userEvent.click(askItem('Cutting board'))
    await userEvent.click(screen.getByRole('button', { name: 'What can I use instead?' }))

    expect(ask).toHaveBeenCalledWith({
      subject: { kind: 'equipment', index: 1 },
      steps: sampleTips.steps,
      equipment: sampleTips.equipment,
      question: 'What can I use instead?',
      source: 'chip',
    })
  })

  it('keeps one panel open across the steps and the equipment', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Ask about step 2' }))
    expect(screen.getByRole('group', { name: 'Ask about step 2' })).toBeInTheDocument()

    await userEvent.click(askItem('Large pan'))
    expect(screen.queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    // Switching moves focus into the new panel's field.
    expect(within(itemPanel('Large pan')!).getByRole('textbox')).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Ask about step 1' }))
    expect(itemPanel('Large pan')).toBeNull()
    expect(screen.getByRole('group', { name: 'Ask about step 1' })).toBeInTheDocument()
  })

  it('Close and Escape return focus to the item’s Ask button', async () => {
    render(<Harness />)
    await userEvent.click(askItem('Large pan'))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(itemPanel('Large pan')).toBeNull()
    expect(askItem('Large pan')).toHaveFocus()

    await userEvent.click(askItem('Cutting board'))
    await userEvent.click(screen.getByRole('textbox'))
    await userEvent.keyboard('{Escape}')
    expect(itemPanel('Cutting board')).toBeNull()
    expect(askItem('Cutting board')).toHaveFocus()
  })
})

import { useState } from 'react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

// The × and the pencil are named by `aria-label`; the rest by their text.
const buttonName = (b: HTMLElement) => b.getAttribute('aria-label') ?? b.textContent

/** "Your notes", the disclosure button over the household's notes (HON-1259) */
const notesTrigger = () => screen.getByRole('button', { name: 'Your notes' })

/** A step as the subject of a cook question (HON-983) */
/** Open a row's ⋯ menu and choose one of its items (HON-1350). */
async function pick(menuButton: HTMLElement, item: string) {
  await userEvent.click(menuButton)
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

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

    // The household can still cook from their own text (HON-1259).
    it('keeps the notes, closed, after the skeleton', () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={true}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Use extra garlic"
        />,
      )
      expect(notesTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Use extra garlic')).toBeNull()
      expect(
        screen.getByTestId('preparation-steps-loading').compareDocumentPosition(notesTrigger()) &
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

    it('keeps the notes, closed, with the error', async () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={false}
          error="Failed to load"
          onRetry={vi.fn()}
          preparationNotes="My notes here"
        />,
      )
      expect(notesTrigger()).toHaveAttribute('aria-expanded', 'false')
      await userEvent.click(notesTrigger())
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

    it('shows only the closed notes when tips are null but notes exist', () => {
      render(
        <PreparationSteps
          steps={null}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Cook slowly"
        />,
      )
      expect(screen.getByRole('heading', { level: 3, name: 'Your notes' })).toBeInTheDocument()
      expect(notesTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText('Cook slowly')).toBeNull()
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

    // The generated steps are the method; the notes are the household's
    // text, closed under the Tip until opened (HON-1259).
    it('puts the notes after the generated steps, closed until opened', async () => {
      render(
        <PreparationSteps
          steps={sampleTips}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          preparationNotes={'Double the garlic.\nServe with rice.'}
        />,
      )
      const tip = screen.getByText('Let the meat rest for 5 minutes before serving.')
      expect(
        tip.compareDocumentPosition(notesTrigger()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(notesTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText(/Double the garlic/)).toBeNull()

      await userEvent.click(notesTrigger())

      expect(notesTrigger()).toHaveAttribute('aria-expanded', 'true')
      const notes = screen.getByText(/Double the garlic/)
      expect(notes.textContent).toBe('Double the garlic.\nServe with rice.')
      expect(notes).toHaveClass('whitespace-pre-line')

      await userEvent.click(notesTrigger())
      expect(notesTrigger()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByText(/Double the garlic/)).toBeNull()
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

// Each generated step gets a ⋯ menu beside its toggle (HON-969, HON-1350).
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
  const menuButton = (n: number) => screen.getByRole('button', { name: `Ask about step ${n}` })
  const openPanel = (n: number) => pick(menuButton(n), 'Ask your own question')
  const panel = (n: number) => screen.queryByRole('group', { name: `Ask about step ${n}` })
  const card = (n = 1) => panel(n)?.querySelector<HTMLElement>('[data-slot="card"]')

  it('renders a ⋯ button per step only with cookQuestion', () => {
    const { unmount } = render(<Harness />)
    expect(menuButton(1)).toHaveAttribute('aria-expanded', 'false')
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

  it('sizes the ⋯ button 44px or more, keeps the step in its name, and sets no title', () => {
    render(<Harness />)
    const button = menuButton(2)
    // `icon-lg`: 48px below `md`, 44px from it.
    expect(button).toHaveClass('size-12', 'md:size-11')
    expect(within(button).queryByText('Ask')).toBeNull()
    expect(button).not.toHaveAttribute('title')
  })

  it('shows no ⋯ button on the static numbered list', () => {
    render(<PreparationSteps steps={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Ask about step/ })).toBeNull()
  })

  it('lists the three ready-made questions, a separator, then "Ask your own question"', async () => {
    render(<Harness />)
    await userEvent.click(menuButton(1))
    const menu = await screen.findByRole('menu')

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      "How do I know it's done?",
      'What can I substitute here?',
      "I'm short on time",
      'Ask your own question',
    ])
    const separator = within(menu).getByRole('separator')
    expect(separator.previousElementSibling).toHaveTextContent("I'm short on time")
    expect(separator.nextElementSibling).toHaveTextContent('Ask your own question')
  })

  it('"Ask your own question" opens a panel with the field focused and no chips, one at a time', async () => {
    const ask = vi.fn()
    render(<Harness controls={{ ask }} />)
    await openPanel(1)

    const first = panel(1)!
    expect(menuButton(1)).toHaveAttribute('aria-expanded', 'true')
    expect(menuButton(1)).toHaveAttribute('aria-controls', first.id)
    const field = within(first).getByRole('textbox', { name: 'Your question' })
    expect(field).toHaveAttribute('placeholder', 'Ask about this step')
    await waitFor(() => expect(field).toHaveFocus())
    expect(within(first).getByRole('button', { name: 'Send' })).toBeVisible()
    expect(within(first).getByRole('button', { name: 'Close' })).toBeVisible()
    expect(within(first).getAllByRole('button').map(buttonName)).toEqual(['Close', 'Send'])
    expect(ask).not.toHaveBeenCalled()

    await openPanel(2)
    expect(panel(1)).toBeNull()
    await waitFor(() => expect(within(panel(2)!).getByRole('textbox')).toHaveFocus())
  })

  it('a ready-made question opens the panel and sends its text, the steps and source chip', async () => {
    const ask = vi.fn()
    render(<Harness controls={{ ask }} />)
    await pick(menuButton(2), 'What can I substitute here?')

    expect(panel(2)).not.toBeNull()
    expect(ask).toHaveBeenCalledOnce()
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
    await openPanel(1)
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
    await openPanel(1)
    await userEvent.type(screen.getByRole('textbox'), 'Done yet?')
    const send = screen.getByRole('button', { name: 'Send' })
    await userEvent.click(send)

    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(send).not.toBeDisabled()
    expect(send).toHaveFocus()
    expect(ask).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Thinking…')
  })

  it('Send does nothing while the answer streams in (HON-979)', async () => {
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
    await openPanel(1)
    await userEvent.type(screen.getByRole('textbox'), 'Done yet?')
    const send = screen.getByRole('button', { name: 'Send' })
    await userEvent.click(send)

    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(ask).not.toHaveBeenCalled()
  })

  // The route keeps generating an answer the browser aborts, so a second pick
  // would bill a second call (HON-1360). Another row's questions stay enabled.
  it.each([
    ['pending', { isPending: true, active: { subject: step(0), question: 'Q', answer: null } }],
    [
      'streaming',
      { isStreaming: true, active: { subject: step(0), question: 'Q', answer: 'Use ' } },
    ],
  ] as const)("disables the row's ready-made questions while its answer is %s", async (_, busy) => {
    const ask = vi.fn()
    render(<Harness controls={{ ask, ...busy }} />)
    await userEvent.click(menuButton(1))
    const menu = await screen.findByRole('menu')
    const item = (name: string) => within(menu).getByRole('menuitem', { name })
    const ready = ["How do I know it's done?", 'What can I substitute here?', "I'm short on time"]

    for (const name of ready) expect(item(name)).toHaveAttribute('aria-disabled', 'true')
    expect(item('Ask your own question')).not.toHaveAttribute('aria-disabled')
    await userEvent.click(item("How do I know it's done?"), { pointerEventsCheck: 0 })
    expect(ask).not.toHaveBeenCalled()

    await userEvent.keyboard('{Escape}')
    await pick(menuButton(2), 'What can I substitute here?')
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ subject: step(1) }))
  })

  it('marks the status busy while the answer streams, without "Thinking…"', async () => {
    const active = { subject: step(0), question: 'Q', answer: 'Use the ' }
    const { rerender } = render(<Harness controls={{ isStreaming: true, active }} />)
    await openPanel(1)
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
    await openPanel(1)
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
    await openPanel(1)
    expect(within(panel(1)!).getByRole('status')).toHaveTextContent('Use the yoghurt you have.')
  })

  it('shows no asked question without an active question', async () => {
    render(<Harness />)
    await openPanel(1)
    expect(within(panel(1)!).queryByText(/^You asked:/)).toBeNull()
    expect(within(panel(1)!).queryByRole('button', { name: 'Edit question' })).toBeNull()
  })

  it('shows no asked question for another step’s question', async () => {
    render(
      <Harness
        controls={{ active: { subject: step(0), question: 'Done yet?', answer: 'Not yet.' } }}
      />,
    )
    await openPanel(2)
    expect(within(panel(2)!).queryByText(/^You asked:/)).toBeNull()
    expect(within(panel(2)!).queryByRole('button', { name: 'Edit question' })).toBeNull()
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
      await openPanel(1)
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
    await openPanel(1)
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
    await openPanel(2)
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
    await openPanel(2)
    const edit = within(panel(2)!).getByRole('button', { name: 'Edit question' })
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
    await openPanel(1)
    const edit = screen.getByRole('button', { name: 'Edit question' })
    await userEvent.click(edit)
    await userEvent.click(edit)
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('shows the error with Retry when a retry can help, and without it otherwise', async () => {
    const onRetry = vi.fn()
    const { unmount } = render(
      <Harness controls={{ error: { message: 'Took too long.', canRetry: true }, onRetry }} />,
    )
    await openPanel(1)
    expect(screen.getByRole('status')).toHaveTextContent('Took too long.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    // Retry leaves the page as the error clears: focus waits on Close.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    unmount()

    render(<Harness controls={{ error: { message: 'Limit reached.', canRetry: false } }} />)
    await openPanel(1)
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
        const { unmount } = render(<Harness controls={controls} />)
        await openPanel(1)
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
      const { unmount } = render(<Harness controls={{ active, isPending: true }} />)
      await openPanel(1)
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
      const { rerender } = render(<Harness controls={{ active, isPending: true }} />)
      await openPanel(1)
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
      const { rerender } = render(<Harness controls={{ active, isPending: true }} />)
      await openPanel(1)

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

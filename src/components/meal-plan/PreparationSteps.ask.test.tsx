import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { type CookQuestionControls, PreparationSteps } from './PreparationSteps'
import {
  buttonName,
  Harness,
  menuButton,
  openPanel,
  panel,
  pick,
  sampleTips,
  step,
  stubScrollIntoView,
} from './PreparationSteps.ask.fixtures'

// Each generated step gets a ⋯ menu beside its toggle (HON-969, HON-1350).
// The panel's reading order and scrolling are in PreparationSteps.ask-panel.test.tsx.
describe('PreparationSteps cook question', () => {
  stubScrollIntoView()

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
        open={step(0)}
        controls={{
          ask,
          isStreaming: true,
          active: { subject: step(0), question: 'Q', answer: 'Use the ' },
        }}
      />,
    )
    await userEvent.type(screen.getByRole('textbox'), 'Done yet?')
    const send = screen.getByRole('button', { name: 'Send' })
    await userEvent.click(send)

    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(ask).not.toHaveBeenCalled()
  })

  // The route keeps generating an answer the browser aborts, so a second pick
  // would bill a second call (HON-1360). "Ask your own question" opens the
  // panel, which resets the hook and aborts the answer (HON-1442). Another
  // row's questions stay enabled.
  it.each([
    ['pending', { isPending: true, active: { subject: step(0), question: 'Q', answer: null } }],
    [
      'streaming',
      { isStreaming: true, active: { subject: step(0), question: 'Q', answer: 'Use ' } },
    ],
  ] as const)("disables the row's questions while its answer is %s", async (_, busy) => {
    const ask = vi.fn()
    const onOpen = vi.fn()
    render(<Harness open={step(0)} controls={{ ask, ...busy }} onOpen={onOpen} />)
    await userEvent.click(menuButton(1))
    const menu = await screen.findByRole('menu')
    const item = (name: string) => within(menu).getByRole('menuitem', { name })
    const ready = ["How do I know it's done?", 'What can I substitute here?', "I'm short on time"]

    for (const name of ready) expect(item(name)).toHaveAttribute('aria-disabled', 'true')
    expect(item('Ask your own question')).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(item("How do I know it's done?"), { pointerEventsCheck: 0 })
    await userEvent.click(item('Ask your own question'), { pointerEventsCheck: 0 })
    expect(ask).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    expect(within(panel(1)!).getByText('You asked: Q')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(menuButton(2))
    expect(
      await screen.findByRole('menuitem', { name: 'Ask your own question' }),
    ).not.toHaveAttribute('aria-disabled')
    await userEvent.click(screen.getByRole('menuitem', { name: 'What can I substitute here?' }))
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ subject: step(1) }))
  })

  it.each([
    ['arrives', { active: { subject: step(0), question: 'Q', answer: 'Use yoghurt.' } }],
    [
      'fails',
      {
        active: { subject: step(0), question: 'Q', answer: null },
        error: { message: 'Took too long.', canRetry: true },
      },
    ],
    ['is closed', { active: null }],
  ] as const)('enables "Ask your own question" again once the answer %s', async (_, settled) => {
    const pending = { subject: step(0), question: 'Q', answer: null }
    const { rerender } = render(<Harness controls={{ isPending: true, active: pending }} />)
    const askOwn = async () => {
      await userEvent.click(menuButton(1))
      return screen.findByRole('menuitem', { name: 'Ask your own question' })
    }
    expect(await askOwn()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')

    rerender(<Harness controls={settled} />)
    expect(await askOwn()).not.toHaveAttribute('aria-disabled')
  })

  it('marks the status busy while the answer streams, without "Thinking…"', async () => {
    const active = { subject: step(0), question: 'Q', answer: 'Use the ' }
    const { rerender } = render(<Harness open={step(0)} controls={{ isStreaming: true, active }} />)
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
      const { unmount } = render(<Harness open={step(0)} controls={controls} />)
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
        open={step(0)}
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
        open={step(1)}
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
})

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreparationSteps as PreparationStepsData } from '@/components/meal-plan/types'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

import {
  type CookQuestionControls,
  PreparationEquipment,
  PreparationSteps,
} from './PreparationSteps'

// The ⋯ menus and question panels of "You'll need" (HON-983). The steps' own
// are in PreparationSteps.ask.test.tsx.

const sampleTips: PreparationStepsData = {
  equipment: ['Large pan', 'Cutting board'],
  steps: ['Chop vegetables', 'Heat oil in pan', 'Cook for 10 minutes'],
  pitfalls: ['Do not overcook the chicken', 'Season before cooking'],
  tip: 'Let the meat rest for 5 minutes before serving.',
}

// The × and the pencil are named by `aria-label`; the rest by their text.
const buttonName = (b: HTMLElement) => b.getAttribute('aria-label') ?? b.textContent

/** Open a row's ⋯ menu and choose one of its items (HON-1350). */
async function pick(menuButton: HTMLElement, item: string) {
  await userEvent.click(menuButton)
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

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
  const menuItem = (item: string) => screen.getByRole('button', { name: `Ask about ${item}` })
  const openItemPanel = (item: string) => pick(menuItem(item), 'Ask your own question')
  const itemPanel = (item: string) => screen.queryByRole('group', { name: `Ask about ${item}` })

  it('ends each row in a ⋯ button named for the item, only with cookQuestion', () => {
    const { unmount } = render(<Harness />)
    const list = screen.getByRole('list', { name: "You'll need" })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByRole('button', { name: 'Ask about Large pan' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(items[1]!).getByText('Cutting board')).toBeInTheDocument()
    expect(menuItem('Cutting board')).toHaveClass('size-12', 'md:size-11')
    unmount()

    render(<PreparationEquipment equipment={sampleTips.equipment} steps={sampleTips.steps} />)
    expect(screen.queryByRole('button', { name: /^Ask about/ })).toBeNull()
  })

  it('shows no ⋯ button without steps to send', () => {
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

  it('shows no ⋯ button on a row the route cannot answer about', () => {
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

  it('lists the item\'s three ready-made questions, a separator, then "Ask your own question"', async () => {
    render(<Harness />)
    await userEvent.click(menuItem('Cutting board'))
    const menu = await screen.findByRole('menu')

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'What can I use instead?',
      'Does the size matter?',
      'Can I skip it?',
      'Ask your own question',
    ])
    expect(within(menu).getByRole('separator').nextElementSibling).toHaveTextContent(
      'Ask your own question',
    )
  })

  it('"Ask your own question" opens a panel under the row with the field and its placeholder', async () => {
    const ask = vi.fn()
    render(<Harness ask={ask} />)
    await openItemPanel('Cutting board')

    const panel = itemPanel('Cutting board')!
    expect(menuItem('Cutting board')).toHaveAttribute('aria-expanded', 'true')
    expect(menuItem('Cutting board').closest('li')).toContainElement(panel)
    // The same card as a step's (HON-1371).
    expect(panel.querySelector('[data-slot="card"]')).toHaveClass('rounded-xl', 'bg-secondary/50')
    expect(within(panel).getAllByRole('button').map(buttonName)).toEqual(['Close', 'Send'])
    const field = within(panel).getByRole('textbox', { name: 'Your question' })
    expect(field).toHaveAttribute('placeholder', 'Ask about this item')
    await waitFor(() => expect(field).toHaveFocus())
    expect(ask).not.toHaveBeenCalled()
  })

  it('a ready-made question sends the item as the subject, and focus goes to Close', async () => {
    const ask = vi.fn()
    render(<Harness ask={ask} />)
    await pick(menuItem('Cutting board'), 'What can I use instead?')

    expect(ask).toHaveBeenCalledWith({
      subject: { kind: 'equipment', index: 1 },
      steps: sampleTips.steps,
      equipment: sampleTips.equipment,
      question: 'What can I use instead?',
      source: 'chip',
    })
    const close = within(itemPanel('Cutting board')!).getByRole('button', { name: 'Close' })
    await waitFor(() => expect(close).toHaveFocus())
  })

  it('keeps one panel open across the steps and the equipment', async () => {
    render(<Harness />)
    await pick(screen.getByRole('button', { name: 'Ask about step 2' }), 'Ask your own question')
    expect(screen.getByRole('group', { name: 'Ask about step 2' })).toBeInTheDocument()

    await openItemPanel('Large pan')
    expect(screen.queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await waitFor(() => expect(within(itemPanel('Large pan')!).getByRole('textbox')).toHaveFocus())

    await pick(screen.getByRole('button', { name: 'Ask about step 1' }), 'Ask your own question')
    expect(itemPanel('Large pan')).toBeNull()
    expect(screen.getByRole('group', { name: 'Ask about step 1' })).toBeInTheDocument()
  })

  it('Close and Escape return focus to the item’s ⋯ button', async () => {
    render(<Harness />)
    await openItemPanel('Large pan')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(itemPanel('Large pan')).toBeNull()
    expect(menuItem('Large pan')).toHaveFocus()

    await openItemPanel('Cutting board')
    await userEvent.click(screen.getByRole('textbox'))
    await userEvent.keyboard('{Escape}')
    expect(itemPanel('Cutting board')).toBeNull()
    expect(menuItem('Cutting board')).toHaveFocus()
  })
})

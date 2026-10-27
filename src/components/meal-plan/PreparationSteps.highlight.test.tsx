import { useState } from 'react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparationSteps } from './PreparationSteps'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

const STEPS = ['Chop vegetables', 'Heat oil in pan', 'Cook for 10 minutes']

/** The modal's side: done steps and one open step, held in state. */
function Harness() {
  const [doneSteps, setDoneSteps] = useState(new Set<number>())
  const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
  return (
    <PreparationSteps
      steps={{ equipment: [], steps: STEPS, pitfalls: [] }}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
      doneSteps={doneSteps}
      onToggleStep={(i) => setDoneSteps((prev) => new Set(prev).add(i))}
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
      }}
    />
  )
}

const toggle = (name: string) => screen.getByRole('button', { name })
const menuButton = (n: number) => screen.getByRole('button', { name: `Ask about step ${n}` })
/** The row that holds a step's toggle and its ⋯ menu. */
const row = (name: string) => toggle(name).parentElement!

describe('PreparationSteps current step highlight (HON-1369)', () => {
  // jsdom has no scrollIntoView; the panel calls it on open.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('puts the whole current row, ⋯ menu included, on the chip token', () => {
    render(<Harness />)
    expect(row('Chop vegetables')).toHaveClass('bg-secondary', 'rounded-lg')
    expect(row('Chop vegetables')).toContainElement(menuButton(1))
    expect(toggle('Chop vegetables')).not.toHaveClass('bg-secondary')
    expect(row('Heat oil in pan')).not.toHaveClass('bg-secondary')
  })

  it('moves the highlight, with its ⋯ menu, to the next step on tick', async () => {
    render(<Harness />)
    await userEvent.click(toggle('Chop vegetables'))
    expect(row('Chop vegetables')).not.toHaveClass('bg-secondary')
    expect(row('Heat oil in pan')).toHaveClass('bg-secondary')
    expect(row('Heat oil in pan')).toContainElement(menuButton(2))
  })

  it('keeps an open question panel outside the highlight', async () => {
    render(<Harness />)
    await userEvent.click(menuButton(1))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ask your own question' }))
    const panel = screen.getByRole('group', { name: 'Ask about step 1' })
    expect(row('Chop vegetables')).not.toContainElement(panel)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparationEquipment, PreparationSteps } from './PreparationSteps'
import { sampleTips } from './PreparationSteps.ask.fixtures'
import type { PreparationSteps as PreparationStepsData } from '@/components/meal-plan/types'

// The steps' cook question tests are in PreparationSteps.ask.test.tsx and
// PreparationSteps.ask-panel.test.tsx.

/** "Your notes", the disclosure button over the household's notes (HON-1259) */
const notesTrigger = () => screen.getByRole('button', { name: 'Your notes' })
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

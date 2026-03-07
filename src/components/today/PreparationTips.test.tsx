import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparationTips } from './PreparationTips'
import type { StructuredTips } from '@/components/meal-plan/types'

const sampleTips: StructuredTips = {
  equipment: ['Large pan', 'Cutting board'],
  steps: ['Chop vegetables', 'Heat oil in pan', 'Cook for 10 minutes'],
  pitfalls: ['Do not overcook the chicken', 'Season before cooking'],
  tip: 'Let the meat rest for 5 minutes before serving.',
}

describe('PreparationTips', () => {
  describe('loading state', () => {
    it('renders loading skeletons', () => {
      render(<PreparationTips tips={null} isLoading={true} error={null} onRetry={vi.fn()} />)
      expect(screen.getByText('Equipment needed')).toBeInTheDocument()
      expect(screen.getByText('Steps')).toBeInTheDocument()
      expect(screen.getByText('Watch out for')).toBeInTheDocument()
    })

    it('shows user notes alongside skeletons when notes exist', () => {
      render(
        <PreparationTips
          tips={null}
          isLoading={true}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Use extra garlic"
        />,
      )
      expect(screen.getByText('Your notes')).toBeInTheDocument()
      expect(screen.getByText('Use extra garlic')).toBeInTheDocument()
      expect(screen.getByText('Additional tips')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders error message with retry button', () => {
      render(
        <PreparationTips
          tips={null}
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
        <PreparationTips tips={null} isLoading={false} error="Failed to load" onRetry={onRetry} />,
      )

      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(onRetry).toHaveBeenCalledOnce()
    })

    it('shows user notes alongside error when notes exist', () => {
      render(
        <PreparationTips
          tips={null}
          isLoading={false}
          error="Failed to load"
          onRetry={vi.fn()}
          preparationNotes="My notes here"
        />,
      )
      expect(screen.getByText('Your notes')).toBeInTheDocument()
      expect(screen.getByText('My notes here')).toBeInTheDocument()
    })
  })

  describe('loaded state', () => {
    it('returns null when no tips and no notes', () => {
      const { container } = render(
        <PreparationTips tips={null} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(container.firstChild).toBeNull()
    })

    it('shows only user notes when tips are null but notes exist', () => {
      render(
        <PreparationTips
          tips={null}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          preparationNotes="Cook slowly"
        />,
      )
      expect(screen.getByText('Your notes')).toBeInTheDocument()
      expect(screen.getByText('Cook slowly')).toBeInTheDocument()
    })

    it('renders equipment list', () => {
      render(<PreparationTips tips={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />)
      expect(screen.getByText('Equipment needed')).toBeInTheDocument()
      expect(screen.getByText('Large pan')).toBeInTheDocument()
      expect(screen.getByText('Cutting board')).toBeInTheDocument()
    })

    it('renders steps as numbered list', () => {
      render(<PreparationTips tips={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />)
      expect(screen.getByText('Steps')).toBeInTheDocument()
      expect(screen.getByText('Chop vegetables')).toBeInTheDocument()
      expect(screen.getByText('Heat oil in pan')).toBeInTheDocument()
      expect(screen.getByText('Cook for 10 minutes')).toBeInTheDocument()
    })

    it('renders pitfalls', () => {
      render(<PreparationTips tips={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />)
      expect(screen.getByText('Watch out for')).toBeInTheDocument()
      expect(screen.getByText('Do not overcook the chicken')).toBeInTheDocument()
      expect(screen.getByText('Season before cooking')).toBeInTheDocument()
    })

    it('renders tip callout', () => {
      render(<PreparationTips tips={sampleTips} isLoading={false} error={null} onRetry={vi.fn()} />)
      expect(screen.getByText('Tip')).toBeInTheDocument()
      expect(
        screen.getByText('Let the meat rest for 5 minutes before serving.'),
      ).toBeInTheDocument()
    })

    it('hides sections when they are empty', () => {
      const minimalTips: StructuredTips = {
        pitfalls: ['Watch the heat'],
      }
      render(
        <PreparationTips tips={minimalTips} isLoading={false} error={null} onRetry={vi.fn()} />,
      )
      expect(screen.queryByText('Equipment needed')).not.toBeInTheDocument()
      expect(screen.queryByText('Steps')).not.toBeInTheDocument()
      expect(screen.queryByText('Tip')).not.toBeInTheDocument()
      expect(screen.getByText('Watch out for')).toBeInTheDocument()
    })
  })
})

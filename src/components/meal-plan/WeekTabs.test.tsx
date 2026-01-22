import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { WeekTabs } from './WeekTabs'

// Mock next/link to render as a simple anchor
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode
    href: string
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('WeekTabs', () => {
  const defaultProps = {
    activeWeek: 'current' as const,
    currentWeekDays: 7,
    hasLastPlan: true,
    hasCurrentPlan: true,
    hasNextPlan: true,
  }

  describe('basic rendering', () => {
    it('renders all three tabs when hasLastPlan is true and currentWeekDays > 0', () => {
      render(<WeekTabs {...defaultProps} />)

      expect(screen.getByRole('link', { name: /last week/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /this week/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /next week/i })).toBeInTheDocument()
    })

    it('renders navigation landmark with correct label', () => {
      render(<WeekTabs {...defaultProps} />)

      expect(screen.getByRole('navigation', { name: 'Week navigation' })).toBeInTheDocument()
    })
  })

  describe('Last week tab visibility', () => {
    it('shows Last week tab when hasLastPlan is true', () => {
      render(<WeekTabs {...defaultProps} hasLastPlan={true} />)

      expect(screen.getByRole('link', { name: /last week/i })).toBeInTheDocument()
    })

    it('hides Last week tab when hasLastPlan is false', () => {
      render(<WeekTabs {...defaultProps} hasLastPlan={false} />)

      expect(screen.queryByRole('link', { name: /last week/i })).not.toBeInTheDocument()
    })
  })

  describe('This week tab visibility', () => {
    it('shows This week tab when currentWeekDays > 0', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={3} />)

      expect(screen.getByRole('link', { name: /this week/i })).toBeInTheDocument()
    })

    it('hides This week tab when currentWeekDays is 0 (Sunday)', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={0} />)

      expect(screen.queryByRole('link', { name: /this week/i })).not.toBeInTheDocument()
    })
  })

  describe('days badge display', () => {
    it('does not show days badge when currentWeekDays is 7 (full week)', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={7} />)

      expect(screen.queryByText(/\d+ days?\)/)).not.toBeInTheDocument()
    })

    it('shows days badge with plural when currentWeekDays < 7 and > 1', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={3} />)

      expect(screen.getByText('(3 days)')).toBeInTheDocument()
    })

    it('shows days badge with singular when currentWeekDays is 1', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={1} />)

      expect(screen.getByText('(1 day)')).toBeInTheDocument()
    })

    it('shows days badge for 6 days', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={6} />)

      expect(screen.getByText('(6 days)')).toBeInTheDocument()
    })
  })

  describe('No plan badge display', () => {
    it('shows No plan badge on This week tab when hasCurrentPlan is false', () => {
      render(<WeekTabs {...defaultProps} hasCurrentPlan={false} />)

      const thisWeekTab = screen.getByRole('link', { name: /this week/i })
      expect(thisWeekTab).toHaveTextContent('No plan')
    })

    it('does not show No plan badge on This week tab when hasCurrentPlan is true', () => {
      render(<WeekTabs {...defaultProps} hasCurrentPlan={true} />)

      const thisWeekTab = screen.getByRole('link', { name: /this week/i })
      expect(thisWeekTab).not.toHaveTextContent('No plan')
    })

    it('shows No plan badge on Next week tab when hasNextPlan is false', () => {
      render(<WeekTabs {...defaultProps} hasNextPlan={false} />)

      const nextWeekTab = screen.getByRole('link', { name: /next week/i })
      expect(nextWeekTab).toHaveTextContent('No plan')
    })

    it('does not show No plan badge on Next week tab when hasNextPlan is true', () => {
      render(<WeekTabs {...defaultProps} hasNextPlan={true} />)

      const nextWeekTab = screen.getByRole('link', { name: /next week/i })
      expect(nextWeekTab).not.toHaveTextContent('No plan')
    })

    it('shows No plan badges on both tabs when neither has a plan', () => {
      render(<WeekTabs {...defaultProps} hasCurrentPlan={false} hasNextPlan={false} />)

      const noPlanBadges = screen.getAllByText('No plan')
      expect(noPlanBadges).toHaveLength(2)
    })
  })

  describe('active tab state', () => {
    it('sets aria-current="page" on Last week tab when activeWeek is "last"', () => {
      render(<WeekTabs {...defaultProps} activeWeek="last" />)

      expect(screen.getByRole('link', { name: /last week/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(screen.getByRole('link', { name: /this week/i })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('link', { name: /next week/i })).not.toHaveAttribute('aria-current')
    })

    it('sets aria-current="page" on This week tab when activeWeek is "current"', () => {
      render(<WeekTabs {...defaultProps} activeWeek="current" />)

      expect(screen.getByRole('link', { name: /last week/i })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('link', { name: /this week/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(screen.getByRole('link', { name: /next week/i })).not.toHaveAttribute('aria-current')
    })

    it('sets aria-current="page" on Next week tab when activeWeek is "next"', () => {
      render(<WeekTabs {...defaultProps} activeWeek="next" />)

      expect(screen.getByRole('link', { name: /last week/i })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('link', { name: /this week/i })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('link', { name: /next week/i })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })
  })

  describe('link href generation', () => {
    it('generates correct href for Last week tab', () => {
      render(<WeekTabs {...defaultProps} />)

      expect(screen.getByRole('link', { name: /last week/i })).toHaveAttribute(
        'href',
        '/meal-plan?week=last',
      )
    })

    it('generates correct href for This week tab', () => {
      render(<WeekTabs {...defaultProps} />)

      expect(screen.getByRole('link', { name: /this week/i })).toHaveAttribute(
        'href',
        '/meal-plan?week=current',
      )
    })

    it('generates correct href for Next week tab', () => {
      render(<WeekTabs {...defaultProps} />)

      expect(screen.getByRole('link', { name: /next week/i })).toHaveAttribute(
        'href',
        '/meal-plan?week=next',
      )
    })
  })

  describe('edge cases', () => {
    it('handles Sunday (0 days) with no last plan - only shows Next week', () => {
      render(
        <WeekTabs
          {...defaultProps}
          currentWeekDays={0}
          hasLastPlan={false}
          hasCurrentPlan={false}
          hasNextPlan={false}
        />,
      )

      expect(screen.queryByRole('link', { name: /last week/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /this week/i })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /next week/i })).toBeInTheDocument()
    })

    it('handles partial week with days badge and no plan badge together', () => {
      render(<WeekTabs {...defaultProps} currentWeekDays={3} hasCurrentPlan={false} />)

      const thisWeekTab = screen.getByRole('link', { name: /this week/i })
      expect(thisWeekTab).toHaveTextContent('(3 days)')
      expect(thisWeekTab).toHaveTextContent('No plan')
    })
  })
})

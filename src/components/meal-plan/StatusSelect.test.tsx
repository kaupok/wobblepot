import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusSelect, type MealStatus } from './StatusSelect'

const LABELS: Record<MealStatus, string> = {
  planned: 'Planned',
  completed: 'Completed',
  skipped: 'Skipped',
}

describe('StatusSelect', () => {
  it.each(Object.entries(LABELS) as [MealStatus, string][])(
    'shows the %s status as a hidden icon and the label alone',
    (status, label) => {
      render(<StatusSelect value={status} onChange={vi.fn()} />)
      const trigger = screen.getByRole('combobox')
      // Only the label is text: no emoji or glyph for a screen reader to read out.
      expect(trigger).toHaveTextContent(new RegExp(`^${label}$`))
      const icon = trigger.querySelector('[data-slot="select-value"] svg')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveClass('size-4')
    },
  )
})

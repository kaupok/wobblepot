import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IngredientSearch } from './IngredientSearch'
import type { IngredientResult } from './meal-form-types'

const mockIngredients: IngredientResult[] = [
  { id: '1', name: 'Tomato', category: 'vegetable', defaultUnit: 'g' },
  { id: '2', name: 'Tofu', category: 'protein', defaultUnit: 'g' },
]

function mockFetchSuccess(ingredients: IngredientResult[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ingredients }),
  })
}

describe('IngredientSearch ARIA attributes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should have combobox role on input', () => {
    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    expect(input).toBeInTheDocument()
  })

  it('should have aria-expanded=false when dropdown is closed', () => {
    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('should have aria-autocomplete=list on input', () => {
    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('should not have aria-controls when dropdown is closed', () => {
    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    expect(input).not.toHaveAttribute('aria-controls')
  })

  it('should show listbox with options when results appear', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    const listbox = screen.getByRole('listbox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
  })

  it('should set aria-selected on highlighted option via keyboard', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    // No option highlighted initially
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    // Arrow down to highlight first option
    await user.keyboard('{ArrowDown}')

    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)
  })

  it('should update aria-activedescendant when navigating options', async () => {
    mockFetchSuccess(mockIngredients)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      <IngredientSearch disabled={false} existingIngredientIds={[]} onAddIngredient={vi.fn()} />,
    )

    const input = screen.getByRole('combobox')
    await user.type(input, 'tom')
    await vi.advanceTimersByTimeAsync(350)

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    // No activedescendant initially
    expect(input).not.toHaveAttribute('aria-activedescendant')

    // Navigate down twice
    await user.keyboard('{ArrowDown}')
    const options = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id)

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id)
  })
})

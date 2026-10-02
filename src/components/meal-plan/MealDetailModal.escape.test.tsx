import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealDetailModal } from './MealDetailModal'
import type { MealData } from './types'

// Escape in the cook view's note and "Serves" fields (HON-949), with the real
// `NoteEditor` and `ServingControl`. `MealDetailModal.cook.test.tsx` mocks
// `NoteEditor` module-wide, so these live in their own file.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

const meal: MealData = {
  id: 'meal-1',
  name: 'Lentil soup',
  kidFriendly: false,
  components: [],
  nutrition: {} as MealData['nutrition'],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderModal() {
  const { wrapper } = createQueryWrapper()
  const onOpenChange = vi.fn()
  const onNoteChange = vi.fn()
  const onServingOverrideChange = vi.fn()
  render(
    <MealDetailModal
      meal={meal}
      householdSize={4}
      status="planned"
      open
      onOpenChange={onOpenChange}
      planId="plan-1"
      entryId="entry-1"
      onNoteChange={onNoteChange}
      onServingOverrideChange={onServingOverrideChange}
    />,
    { wrapper },
  )
  return { onOpenChange, onNoteChange, onServingOverrideChange }
}

describe('MealDetailModal Escape in a field (HON-949)', () => {
  it('cancels the note and keeps the view open', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onNoteChange } = renderModal()

    await user.click(screen.getByRole('button', { name: 'Add note' }))
    const textarea = screen.getByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(textarea).toHaveFocus())
    await user.type(textarea, 'x')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Meal note' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onNoteChange).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement),
    )
  })

  it('cancels the serving count and keeps the view open', async () => {
    const user = userEvent.setup()
    const { onOpenChange, onServingOverrideChange } = renderModal()

    await user.click(screen.getByRole('button', { name: /serves 4/i }))
    const input = screen.getByRole('textbox', { name: 'Number of servings' })
    await waitFor(() => expect(input).toHaveFocus())
    await user.keyboard('6{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Number of servings' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /serves 4/i })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onServingOverrideChange).not.toHaveBeenCalled()
  })

  it('closes the view on a second Escape, from the panel', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderModal()

    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Meal note' })).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()

    screen.getByRole('dialog').focus()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes the view on Escape with focus on the panel', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderModal()

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

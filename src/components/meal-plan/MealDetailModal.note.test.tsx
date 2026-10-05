import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealDetailModal } from './MealDetailModal'
import type { MealData } from './types'

// The cook view's note, opened from the ⋯ menu on the title row (HON-966),
// with the real `NoteEditor`. `MealDetailModal.cook.test.tsx` mocks
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderModal({ note = null, open = true }: { note?: string | null; open?: boolean } = {}) {
  const { wrapper } = createQueryWrapper()
  const onNoteChange = vi.fn()
  const props = {
    meal,
    householdServings: 4,
    status: 'planned' as const,
    onOpenChange: vi.fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    note,
    onNoteChange,
  }
  const view = render(<MealDetailModal {...props} open={open} />, { wrapper })
  const setOpen = (next: boolean) => view.rerender(<MealDetailModal {...props} open={next} />)
  return { onNoteChange, setOpen }
}

const trigger = () => screen.getByRole('button', { name: 'More actions: Lentil soup' })

async function chooseFromMenu(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(trigger())
  await user.click(await screen.findByRole('menuitem', { name: item }))
  return screen.findByRole('textbox', { name: 'Meal note' })
}

describe('MealDetailModal note menu (HON-966)', () => {
  it('shows no standalone Add note button', () => {
    renderModal()

    expect(trigger()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument()
  })

  it('offers Add note without a note, and focuses the editor it opens', async () => {
    const user = userEvent.setup()
    renderModal()

    const textarea = await chooseFromMenu(user, 'Add note')
    await waitFor(() => expect(textarea).toHaveFocus())
  })

  it('offers Edit note with a note', async () => {
    const user = userEvent.setup()
    renderModal({ note: 'Double the garlic' })

    await user.click(trigger())
    expect(await screen.findByRole('menuitem', { name: 'Edit note' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add note' })).not.toBeInTheDocument()
  })

  it('returns focus to the trigger on Cancel', async () => {
    const user = userEvent.setup()
    renderModal()

    const textarea = await chooseFromMenu(user, 'Add note')
    await waitFor(() => expect(textarea).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(textarea).not.toBeInTheDocument()
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('returns focus to the trigger on Save', async () => {
    const user = userEvent.setup()
    const { onNoteChange } = renderModal({ note: 'Double the garlic' })

    const textarea = await chooseFromMenu(user, 'Edit note')
    await waitFor(() => expect(textarea).toHaveFocus())
    await user.type(textarea, ' and lemon{Enter}')
    await waitFor(() => expect(onNoteChange).toHaveBeenCalledWith('Double the garlic and lemon'))

    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('returns focus to the slip when the editor was opened from it', async () => {
    const user = userEvent.setup()
    renderModal({ note: 'Double the garlic' })

    await user.click(screen.getByRole('button', { name: 'Double the garlic' }))
    const textarea = screen.getByRole('textbox', { name: 'Meal note' })
    await waitFor(() => expect(textarea).toHaveFocus())
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Double the garlic' })).toHaveFocus(),
    )
  })

  it('drops an open editor when the view closes', async () => {
    const user = userEvent.setup()
    const { setOpen } = renderModal()

    await chooseFromMenu(user, 'Add note')
    setOpen(false)
    setOpen(true)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Meal note' })).not.toBeInTheDocument()
  })
})

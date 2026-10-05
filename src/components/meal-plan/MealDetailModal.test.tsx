import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealDetailModal } from './MealDetailModal'
import type { MealData } from './types'

const cancelTips = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/hooks/use-meal-tips', () => ({
  useMealTips: () => ({
    tips: null,
    isLoadingTips: false,
    tipsError: null,
    isTipsExpanded: false,
    fetchTips: vi.fn(),
    handleHowToPrepare: vi.fn(),
    cancelTips,
  }),
}))
let imageState: { status: string; imageUrl: string | null; imageHue: number | null } = {
  status: 'none',
  imageUrl: null,
  imageHue: null,
}
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ ...imageState, cancelImage: vi.fn() }),
}))
const useWakeLock = vi.fn()
vi.mock('@/hooks/use-wake-lock', () => ({
  useWakeLock: (active: boolean) => useWakeLock(active),
}))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

/**
 * `MealDetail` is replaced with a probe that renders the servings it is handed
 * and hands its `onServingsChange` back to the test, so the modal's optimistic
 * update and its `Promise<boolean>` contract are exercised without driving the
 * whole serving control.
 */
let onServingsChange: ((servings: number | null) => Promise<boolean>) | undefined
vi.mock('./MealDetail', () => ({
  MealDetail: (props: {
    servings: number
    title?: React.ReactNode
    onServingsChange?: (servings: number | null) => Promise<boolean>
  }) => {
    onServingsChange = props.onServingsChange
    return (
      <div data-slot="cook-view-scroll">
        {props.title}
        <output aria-label="servings">{props.servings}</output>
      </div>
    )
  },
}))

const meal: MealData = {
  id: 'meal-1',
  name: 'Lentil soup',
  kidFriendly: true,
  components: [],
  nutrition: {} as MealData['nutrition'],
}

function renderModal(onServingOverrideChange = vi.fn(), open = true, mealData = meal) {
  const { wrapper } = createQueryWrapper()
  render(
    <MealDetailModal
      meal={mealData}
      householdServings={4}
      open={open}
      onOpenChange={vi.fn()}
      planId="plan-1"
      entryId="entry-1"
      servingOverride={null}
      onServingOverrideChange={onServingOverrideChange}
    />,
    { wrapper },
  )
  return { onServingOverrideChange }
}

function respondWith(status: number, body: unknown = {}) {
  let resolve!: () => void
  const settled = new Promise<void>((r) => (resolve = r))
  const fetchMock = vi.fn(() =>
    settled.then(() => ({ ok: status < 400, status, json: () => Promise.resolve(body) })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, respond: resolve }
}

describe('MealDetailModal servings update', () => {
  beforeEach(() => {
    onServingsChange = undefined
    cancelTips.mockClear()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the new count optimistically and rolls it back when the PATCH fails', async () => {
    const { fetchMock, respond } = respondWith(500, { error: 'Failed to update entry' })
    const { onServingOverrideChange } = renderModal()
    expect(screen.getByLabelText('servings')).toHaveTextContent('4')

    let result!: Promise<boolean>
    act(() => {
      result = onServingsChange!(6)
    })
    expect(await screen.findByLabelText('servings')).toHaveTextContent('6')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ servingOverride: 6 }) }),
    )

    respond()
    await act(async () => {
      await expect(result).resolves.toBe(false)
    })

    expect(screen.getByLabelText('servings')).toHaveTextContent('4')
    expect(toast.error).toHaveBeenCalledWith('Failed to update servings')
    expect(onServingOverrideChange).not.toHaveBeenCalled()
    expect(cancelTips).not.toHaveBeenCalled()
  })

  it('keeps the new count, notifies the parent and drops stale tips on success', async () => {
    const { respond } = respondWith(200, { id: 'entry-1', servingOverride: 6 })
    const { onServingOverrideChange } = renderModal()

    let result!: Promise<boolean>
    act(() => {
      result = onServingsChange!(6)
    })
    respond()
    await act(async () => {
      await expect(result).resolves.toBe(true)
    })

    expect(screen.getByLabelText('servings')).toHaveTextContent('6')
    expect(onServingOverrideChange).toHaveBeenCalledWith(6)
    expect(cancelTips).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('MealDetailModal cook view shell (HON-932)', () => {
  beforeEach(() => {
    useWakeLock.mockClear()
    imageState = { status: 'none', imageUrl: null, imageHue: null }
  })

  it('keeps the screen on while open', () => {
    renderModal()
    expect(useWakeLock).toHaveBeenLastCalledWith(true)
  })

  it('lets the screen sleep while closed', () => {
    renderModal(vi.fn(), false)
    expect(useWakeLock).toHaveBeenLastCalledWith(false)
  })

  it('opens as the fullscreen panel, titled with the meal name', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Lentil soup' })
    expect(dialog).toHaveAttribute('data-size', 'fullscreen')
    expect(screen.getByRole('heading', { name: 'Lentil soup' })).toHaveAttribute(
      'data-variant',
      'display',
    )
  })

  it('marks an own recipe after the title, outside the dialog name (HON-1023)', () => {
    renderModal(vi.fn(), true, { ...meal, isCustom: true })
    const dialog = screen.getByRole('dialog', { name: 'Lentil soup' })
    const titleId = dialog.getAttribute('aria-labelledby')!
    const title = document.getElementById(titleId)!
    expect(title).toHaveTextContent(/^Lentil soup$/)
    const icon = screen.getByRole('button', { name: 'My recipe' })
    expect(icon).toHaveAttribute('data-size', 'icon-display')
    expect(title).not.toContainElement(icon)
    // The icon follows the name inside the heading, joined by a no-break space.
    const heading = title.parentElement!
    expect(heading).toHaveAttribute('data-variant', 'display')
    expect(heading).toContainElement(icon)
    expect(heading.textContent).toBe('Lentil soup\u00a0')
  })

  it('shows no My recipe mark for a library meal', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: 'My recipe' })).not.toBeInTheDocument()
  })

  it('focuses the panel on open rather than its first control', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('tints the whole panel with the meal hue', () => {
    imageState = { status: 'ready', imageUrl: 'https://blob/meal.png', imageHue: 145 }
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-meal-surface', '')
    expect(dialog.style.getPropertyValue('--meal-hue')).toBe('145')
  })

  it('uses the neutral surface for an image without a hue', () => {
    imageState = { status: 'ready', imageUrl: 'https://blob/meal.png', imageHue: null }
    renderModal()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-meal-surface', 'neutral')
    expect(dialog.style.getPropertyValue('--meal-hue')).toBe('')
  })

  it.each(['none', 'generating', 'failed'])('leaves the plain background for %s', (status) => {
    imageState = { status, imageUrl: null, imageHue: null }
    renderModal()
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-meal-surface')
  })
})

describe('MealDetailModal sticky title bar (HON-932)', () => {
  let observers: { options?: IntersectionObserverInit; callback: IntersectionObserverCallback }[]

  beforeEach(() => {
    observers = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          observers.push({ callback, options })
        }
        observe() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('measures the title against the scroll region, which starts under the safe-area inset', () => {
    renderModal()
    const scroller = screen.getByRole('heading', { name: 'Lentil soup' }).parentElement
    expect(scroller).toHaveAttribute('data-slot', 'cook-view-scroll')
    expect(observers.at(-1)?.options).toEqual({
      root: scroller,
      rootMargin: '-60px 0px 0px 0px',
    })
  })

  it('shows the name in the bar once the title has scrolled under it', () => {
    renderModal()
    const bar = screen.getByTestId('cook-view-bar')
    expect(bar).not.toHaveAttribute('data-title-hidden')

    act(() =>
      observers
        .at(-1)!
        .callback(
          [{ isIntersecting: false } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
    )
    expect(bar).toHaveAttribute('data-title-hidden')
  })
})

describe('MealDetailModal focus (HON-932)', () => {
  function ModalWithTrigger({ open }: { open: boolean }) {
    return (
      <>
        <button type="button">Lentil soup card</button>
        <MealDetailModal
          meal={meal}
          householdServings={4}
          open={open}
          onOpenChange={vi.fn()}
          planId="plan-1"
          entryId="entry-1"
        />
      </>
    )
  }

  it('returns focus to the control that opened it when it closes', async () => {
    const { wrapper } = createQueryWrapper()
    const { rerender } = render(<ModalWithTrigger open={false} />, { wrapper })
    const trigger = screen.getByRole('button', { name: 'Lentil soup card' })
    trigger.focus()

    rerender(<ModalWithTrigger open />)
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())

    rerender(<ModalWithTrigger open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})

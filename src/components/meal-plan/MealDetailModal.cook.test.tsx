import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRef, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { MealDetailModal, type MealDetailModalHandle } from './MealDetailModal'
import type { MealData, StructuredTips } from './types'

// The cook view's behaviour with the real `useMealTips` and `MealDetail`
// (HON-933). `MealDetailModal.test.tsx` mocks both module-wide, so these live
// in their own file.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

const meal: MealData = {
  id: 'meal-1',
  name: 'Lentil soup',
  kidFriendly: false,
  components: [],
  nutrition: {} as MealData['nutrition'],
}

const cachedTips: StructuredTips = {
  equipment: ['Soup pot'],
  steps: ['Rinse the lentils', 'Simmer for 25 minutes'],
  pitfalls: [],
}
const generatedTips: StructuredTips = {
  equipment: ['Soup pot'],
  steps: ['Soften the onion', 'Add the lentils and stock'],
  pitfalls: [],
}

const TIPS_URL = '/api/meal-plans/plan-1/entries/entry-1/preparation-tips'

let tipsResponse: () => Response
let fetchMock: ReturnType<typeof vi.fn>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const tipsPosts = () => fetchMock.mock.calls.filter(([url]) => url === TIPS_URL).length

beforeEach(() => {
  tipsResponse = () => json({ tips: generatedTips })
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(url === TIPS_URL ? tipsResponse() : json({ ok: true })),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Props = Partial<React.ComponentProps<typeof MealDetailModal>>

function renderModal(props: Props = {}) {
  const { wrapper } = createQueryWrapper()
  const ref = createRef<MealDetailModalHandle>()
  const element = (next: Props) => (
    <MealDetailModal
      ref={ref}
      meal={meal}
      householdServings={4}
      status="planned"
      open
      onOpenChange={vi.fn()}
      planId="plan-1"
      entryId="entry-1"
      generateOnOpen
      {...props}
      {...next}
    />
  )
  const view = render(element({}), { wrapper })
  return { ref, rerender: (next: Props) => view.rerender(element(next)) }
}

const step = (name: string) => screen.getByRole('button', { name })

describe('MealDetailModal steps on open (HON-933)', () => {
  it('generates the steps of a planned entry once as it opens', async () => {
    renderModal()
    expect(screen.getByText('Writing the steps…')).toBeInTheDocument()
    expect(await screen.findByText('Soften the onion')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'How to prepare' })).not.toBeInTheDocument()
    expect(tipsPosts()).toBe(1)
  })

  it('shows cached tips at once, with no request', () => {
    renderModal({ initialTips: cachedTips })
    expect(screen.getByText('Rinse the lentils')).toBeInTheDocument()
    expect(tipsPosts()).toBe(0)
  })

  it.each([
    ['a completed entry', { status: 'completed' as const, generateOnOpen: false }],
    ['a past or read-only entry', { generateOnOpen: false }],
  ])('does not generate for %s, and offers How to prepare', (_, props) => {
    renderModal(props)
    expect(screen.getByRole('button', { name: 'How to prepare' })).toBeInTheDocument()
    expect(tipsPosts()).toBe(0)
  })

  it('does not generate while closed', () => {
    renderModal({ open: false })
    expect(tipsPosts()).toBe(0)
  })

  it('keeps an error through a reopen, and asks again only on Retry', async () => {
    // 504 is never auto-retried by the hook (HON-693), so one POST per attempt.
    tipsResponse = () => json({ error: 'Timed out' }, 504)
    const { rerender } = renderModal()
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(tipsPosts()).toBe(1)

    rerender({ open: false })
    rerender({ open: true })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(tipsPosts()).toBe(1)

    tipsResponse = () => json({ tips: generatedTips })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Soften the onion')).toBeInTheDocument()
    expect(tipsPosts()).toBe(2)
  })

  it('does not bring back tips a swap dropped when the server data re-renders', async () => {
    const { ref, rerender } = renderModal({
      open: false,
      generateOnOpen: false,
      initialTips: cachedTips,
    })
    act(() => ref.current!.resetForSwap())
    // `router.refresh()` hands the card fresh props; the hook reads them once.
    rerender({ initialTips: { ...cachedTips, steps: ['Stale step'] } })
    rerender({ open: true, initialTips: { ...cachedTips, steps: ['Stale step'] } })

    expect(await screen.findByRole('button', { name: 'How to prepare' })).toBeInTheDocument()
    expect(screen.queryByText('Rinse the lentils')).not.toBeInTheDocument()
    expect(screen.queryByText('Stale step')).not.toBeInTheDocument()
  })
})

describe('MealDetailModal step progress (HON-933)', () => {
  it('survives closing and reopening the view', async () => {
    const { rerender } = renderModal({ initialTips: cachedTips })
    await userEvent.click(step('Rinse the lentils'))
    expect(step('Rinse the lentils')).toHaveAttribute('aria-pressed', 'true')
    expect(step('Simmer for 25 minutes')).toHaveAttribute('data-current')

    rerender({ open: false })
    rerender({ open: true })
    expect(await screen.findByRole('button', { name: 'Rinse the lentils' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('resets on a swap', async () => {
    const { ref } = renderModal({ initialTips: generatedTips })
    await userEvent.click(step('Soften the onion'))
    expect(step('Soften the onion')).toHaveAttribute('aria-pressed', 'true')

    // The swap drops the tips, and the open view generates the new meal's.
    act(() => ref.current!.resetForSwap())
    await waitFor(() => expect(tipsPosts()).toBe(1))
    expect(await screen.findByRole('button', { name: 'Soften the onion' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('resets when a serving change regenerates the steps', async () => {
    renderModal({ initialTips: generatedTips })
    await userEvent.click(step('Soften the onion'))

    await userEvent.click(screen.getByRole('button', { name: /serves 4/i }))
    const input = screen.getByLabelText('Number of servings')
    await userEvent.clear(input)
    await userEvent.type(input, '6{Enter}')

    // The PATCH nulled the cached tips (HON-681); the view writes new ones.
    await waitFor(() => expect(tipsPosts()).toBe(1))
    expect(await screen.findByRole('button', { name: 'Soften the onion' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('MealDetailModal Ask panel and step progress (HON-982)', () => {
  // Ask renders only beside "Done cooking", on an entry somebody is cooking.
  const askPanel = (n: number) => screen.queryByRole('group', { name: `Ask about step ${n}` })

  // jsdom has no scrollIntoView; the panel scrolls into view as it opens (HON-977).
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
  })

  it('closes the panel when its step is ticked, and keeps focus on the toggle', async () => {
    renderModal({ initialTips: cachedTips, onDoneCooking: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: 'Ask about step 2' }))
    expect(askPanel(2)).toBeInTheDocument()

    await userEvent.click(step('Simmer for 25 minutes'))
    expect(step('Simmer for 25 minutes')).toHaveAttribute('aria-pressed', 'true')
    expect(askPanel(2)).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask about step 2' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(step('Simmer for 25 minutes')).toHaveFocus()

    // Un-ticking it reopens nothing.
    await userEvent.click(step('Simmer for 25 minutes'))
    expect(askPanel(2)).toBeNull()
  })

  it('leaves the panel open when another step is ticked', async () => {
    renderModal({ initialTips: cachedTips, onDoneCooking: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: 'Ask about step 2' }))

    await userEvent.click(step('Rinse the lentils'))
    expect(step('Rinse the lentils')).toHaveAttribute('aria-pressed', 'true')
    expect(askPanel(2)).toBeInTheDocument()
  })

  it('keeps the panel when its step is un-ticked', async () => {
    renderModal({ initialTips: cachedTips, onDoneCooking: vi.fn() })
    await userEvent.click(step('Simmer for 25 minutes'))
    await userEvent.click(screen.getByRole('button', { name: 'Ask about step 2' }))
    await userEvent.click(step('Simmer for 25 minutes'))
    expect(step('Simmer for 25 minutes')).toHaveAttribute('aria-pressed', 'false')
    expect(askPanel(2)).toBeInTheDocument()
  })
})

describe('MealDetailModal Done cooking (HON-933)', () => {
  function Stateful({ onDoneCooking }: { onDoneCooking: () => void }) {
    const [open, setOpen] = useState(true)
    return (
      <MealDetailModal
        meal={meal}
        householdServings={4}
        status="planned"
        open={open}
        onOpenChange={setOpen}
        planId="plan-1"
        entryId="entry-1"
        generateOnOpen
        initialTips={cachedTips}
        onDoneCooking={onDoneCooking}
      />
    )
  }

  it('closes the view, then calls onDoneCooking', async () => {
    const onDoneCooking = vi.fn()
    const { wrapper } = createQueryWrapper()
    render(<Stateful onDoneCooking={onDoneCooking} />, { wrapper })

    await userEvent.click(screen.getByRole('button', { name: 'Done cooking' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(onDoneCooking).toHaveBeenCalledTimes(1))
  })

  it('is absent when the caller offers no completion', () => {
    renderModal({ status: 'completed', generateOnOpen: false })
    expect(screen.queryByRole('button', { name: 'Done cooking' })).not.toBeInTheDocument()
  })
})

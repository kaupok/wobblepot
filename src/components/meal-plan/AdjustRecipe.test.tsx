import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef, useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { AdjustRecipe } from './AdjustRecipe'
import type { MealComponent } from './types'

// The box with the real `useAdjustRecipe` and review dialog, against a stubbed
// `fetch` (HON-1244). The harness owns `open` as `MealDetailModal` does, with
// a stand-in for the ⋯ trigger that opens it and takes focus back (HON-1356).

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))

const ADJUST = '/api/meal-plans/plan-1/entries/entry-1/adjust'
const COMPONENTS = '/api/meal-plans/plan-1/entries/entry-1/components'

const components: MealComponent[] = [
  {
    ingredientId: 'cream',
    quantityPerServing: 50,
    ingredient: { id: 'cream', name: 'Cream', category: 'dairy', defaultUnit: 'g' },
  },
]

const yoghurt = {
  op: 'replace',
  original: { id: 'cream', name: 'Cream' },
  originalIngredientId: 'cream',
  replacesChangeId: null,
  replacement: {
    matched: true,
    ingredient: { id: 'yoghurt', name: 'Yoghurt', defaultUnit: 'g', measuredByVolume: false },
    quantityPerServing: 50,
  },
  reason: 'Yoghurt keeps it creamy.',
}

let fetchMock: ReturnType<typeof vi.fn>
const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )

function Harness({
  adjustmentNote,
  initiallyOpen,
  onChanged,
  onClose,
}: {
  adjustmentNote: string | null
  initiallyOpen: boolean
  onChanged: () => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        More actions
      </button>
      <AdjustRecipe
        planId="plan-1"
        entryId="entry-1"
        changes={[]}
        components={components}
        adjustmentNote={adjustmentNote}
        onChanged={onChanged}
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
          triggerRef.current?.focus()
        }}
        fieldRef={fieldRef}
      />
    </>
  )
}

function renderBox(
  adjustAnswer: () => Promise<Response>,
  adjustmentNote: string | null = null,
  { open = true }: { open?: boolean } = {},
) {
  fetchMock = vi.fn((url: string) => (url === ADJUST ? adjustAnswer() : json({ components: [] })))
  vi.stubGlobal('fetch', fetchMock)
  const onChanged = vi.fn()
  const onClose = vi.fn()
  render(
    <Harness
      adjustmentNote={adjustmentNote}
      initiallyOpen={open}
      onChanged={onChanged}
      onClose={onClose}
    />,
    createQueryWrapper(),
  )
  return { onChanged, onClose }
}

const noAnswer = () => json({ changes: [], followInSteps: false, unmatched: [] })
const trigger = () => screen.getByRole('button', { name: 'More actions' })
const field = () => screen.queryByRole('textbox', { name: 'Adjust recipe' })

const ask = async (text: string) => {
  await userEvent.type(screen.getByRole('textbox', { name: 'Adjust recipe' }), text)
  await userEvent.click(screen.getByRole('button', { name: 'Suggest changes' }))
}

describe('AdjustRecipe', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('renders nothing while closed with no stored request', () => {
    renderBox(noAnswer, null, { open: false })

    expect(field()).not.toBeInTheDocument()
    expect(screen.queryByText('Adjust recipe')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suggest changes' })).not.toBeInTheDocument()
  })

  it('shows the stored request while closed, and Clear returns focus to the trigger', async () => {
    renderBox(noAnswer, 'Less salt', { open: false })

    expect(screen.getByText('The steps follow your request: Less salt')).toBeInTheDocument()
    expect(field()).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear request' }))

    await waitFor(() => expect(trigger()).toHaveFocus())
    const put = fetchMock.mock.calls.find(([url]) => url === COMPONENTS)!
    expect(JSON.parse(put[1].body).adjustmentNote).toBeNull()
  })

  it('Close hides the section and drops the draft', async () => {
    const { onClose } = renderBox(noAnswer)

    await userEvent.type(field()!, 'No cream')
    await userEvent.click(screen.getByRole('button', { name: 'Close Adjust recipe' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(field()).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    await userEvent.click(trigger())
    expect(field()).toHaveValue('')
  })

  it('says no change is needed, and writes nothing, for an empty answer', async () => {
    const { onClose } = renderBox(noAnswer)

    await ask('Make it vegetarian')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No ingredient change is needed for that.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ADJUST])
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      instruction: 'Make it vegetarian',
    })
    // The answer is read in the section, so it stays open.
    expect(onClose).not.toHaveBeenCalled()
    expect(field()).toBeInTheDocument()
  })

  it('offers an instruction only the steps can follow for the steps, and stores it alone', async () => {
    const { onClose } = renderBox(() => json({ changes: [], followInSteps: true, unmatched: [] }))

    await ask('Less salt')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'No ingredient change is needed. The steps can follow it instead.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use in the steps' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(([url]) => url === COMPONENTS)!
    expect(JSON.parse(put[1].body)).toEqual({
      changes: [],
      basedOn: [],
      adjustmentNote: 'Less salt',
      noteMode: 'append',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(trigger()).toHaveFocus()
  })

  it('shows the stored request, and Clear removes it alone', async () => {
    renderBox(
      () => json({ changes: [], followInSteps: false, unmatched: [] }),
      'Less salt\nNo cream',
    )

    expect(
      screen.getByText('The steps follow your request: Less salt · No cream'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear request' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(([url]) => url === COMPONENTS)!
    expect(JSON.parse(put[1].body)).toEqual({
      changes: [],
      basedOn: [],
      adjustmentNote: null,
      noteMode: 'replace',
    })
    // The section is open, so focus stays in it.
    await waitFor(() => expect(field()).toHaveFocus())
  })

  it('renders catalog copy for a refusal, never the server text', async () => {
    renderBox(() =>
      json({ error: 'Rate limit exceeded', code: 'rate_limited', resetAt: 'not a date' }, 429),
    )

    await ask('No cream')

    expect(
      await screen.findByText(
        "You've reached this hour's limit for recipe adjustments. Please try again later.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Rate limit exceeded')).not.toBeInTheDocument()
  })

  it('reviews the proposals, then stores them with the instruction and refreshes', async () => {
    const { onChanged, onClose } = renderBox(() =>
      json({ changes: [yoghurt], followInSteps: false, unmatched: [] }),
    )

    await ask('No cream, I have yoghurt')
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const put = fetchMock.mock.calls.find(([url]) => url === COMPONENTS)!
    expect(put[1].method).toBe('PUT')
    expect(JSON.parse(put[1].body)).toEqual({
      changes: [
        {
          originalIngredientId: 'cream',
          replacementIngredientId: 'yoghurt',
          quantityPerServing: 50,
        },
      ],
      basedOn: [],
      adjustmentNote: 'No cream, I have yoghurt',
      noteMode: 'append',
    })
    expect(onChanged).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Applied, the section closes and focus goes to the trigger.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(field()).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('closes the section when the review is dismissed', async () => {
    const { onClose } = renderBox(() =>
      json({ changes: [yoghurt], followInSteps: false, unmatched: [] }),
    )

    await ask('No cream, I have yoghurt')
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.some(([url]) => url === COMPONENTS)).toBe(false)
    expect(field()).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })
})

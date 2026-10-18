import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { AdjustRecipe } from './AdjustRecipe'
import type { MealComponent } from './types'

// The box with the real `useAdjustRecipe` and review dialog, against a stubbed
// `fetch` (HON-1244).

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

function renderBox(adjustAnswer: () => Promise<Response>, adjustmentNote: string | null = null) {
  fetchMock = vi.fn((url: string) => (url === ADJUST ? adjustAnswer() : json({ components: [] })))
  vi.stubGlobal('fetch', fetchMock)
  const onChanged = vi.fn()
  render(
    <AdjustRecipe
      planId="plan-1"
      entryId="entry-1"
      changes={[]}
      components={components}
      adjustmentNote={adjustmentNote}
      onChanged={onChanged}
    />,
    createQueryWrapper(),
  )
  return { onChanged }
}

const ask = async (text: string) => {
  await userEvent.type(screen.getByRole('textbox', { name: 'Adjust recipe' }), text)
  await userEvent.click(screen.getByRole('button', { name: 'Suggest changes' }))
}

describe('AdjustRecipe', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('says no change is needed, and writes nothing, for an empty answer', async () => {
    renderBox(() => json({ changes: [], followInSteps: false, unmatched: [] }))

    await ask('Make it vegetarian')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No ingredient change is needed for that.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([ADJUST])
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      instruction: 'Make it vegetarian',
    })
  })

  it('offers an instruction only the steps can follow for the steps, and stores it alone', async () => {
    renderBox(() => json({ changes: [], followInSteps: true, unmatched: [] }))

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
    const { onChanged } = renderBox(() =>
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
    expect(screen.getByRole('textbox', { name: 'Adjust recipe' })).toHaveValue('')
  })
})

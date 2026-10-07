import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { InlineAddItem } from './InlineAddItem'

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

describe('InlineAddItem field name', () => {
  // getByLabelText matches aria-label but not a placeholder, so this fails if
  // the search is named only by its placeholder (HON-808). The global
  // next-intl mock answers from the English catalog.
  it('names the pantry search independently of its placeholder', () => {
    const { wrapper } = createQueryWrapper()
    render(<InlineAddItem onItemAdded={vi.fn()} />, { wrapper })

    expect(screen.getByLabelText('Add ingredient to pantry')).toHaveAttribute(
      'placeholder',
      'Add ingredient to pantry…',
    )
  })
})

// HON-1100: a row found by another English name shows that name in brackets.
describe('InlineAddItem other English name', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers "plain flour (all-purpose flour)" for "all-purpose" and adds the pool row', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'pantry-1', ingredientId: 'flour' }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ingredients: [
              {
                id: 'flour',
                name: 'plain flour',
                category: 'carb',
                defaultUnit: 'g',
                matchedAs: 'all-purpose flour',
              },
            ],
          }),
      })
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onItemAdded = vi.fn()
    const user = userEvent.setup()
    const { wrapper } = createQueryWrapper()
    render(<InlineAddItem onItemAdded={onItemAdded} />, { wrapper })

    await user.type(screen.getByLabelText('Add ingredient to pantry'), 'all-purpose')
    const option = await screen.findByRole('button', { name: /plain flour/ }, { timeout: 2000 })
    expect(option).toHaveTextContent('plain flour(all-purpose flour)')

    await user.click(option)

    await waitFor(() => expect(onItemAdded).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ ingredientId: 'flour', isStaple: false })
  })
})

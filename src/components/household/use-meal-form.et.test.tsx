import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'

// The global next-intl mock resolves against the English catalog only; an
// Estonian household needs the real provider (see vitest.setup.ts).
vi.unmock('next-intl')
import { act, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import etMessages from '../../../messages/et.json'
import type { MealType } from '@/generated/prisma/enums'
import type { MealFormData } from './meal-form-types'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useMealForm } from './use-meal-form'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const validMeal: MealFormData = {
  name: 'Tomatisupp',
  kidFriendly: false,
  suitableFor: ['dinner' as MealType],
  servings: 4,
  components: [
    {
      ingredientId: 'tomato',
      quantityPerServing: 100,
      ingredient: { id: 'tomato', name: 'Tomat', category: 'vegetable', defaultUnit: 'g' },
    },
  ],
}

function renderForm(meal: MealFormData) {
  const onSuccess = vi.fn()
  const { wrapper: QueryWrapper } = createQueryWrapper()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="et" messages={etMessages}>
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  const view = renderHook(() => useMealForm({ meal, onSuccess }), { wrapper: Wrapper })
  return { ...view, onSuccess }
}

async function submit(result: { current: ReturnType<typeof useMealForm> }) {
  act(() => {
    result.current.handleSubmit({ preventDefault: vi.fn() } as unknown as React.FormEvent)
  })
  await waitFor(() => expect(result.current.isSubmitting).toBe(false))
}

describe('useMealForm save failures in Estonian (HON-844)', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['create', validMeal, 'Failed to create recipe', 'Retsepti loomine ebaõnnestus'],
    [
      'update',
      { ...validMeal, id: 'meal-42' },
      'Failed to update recipe',
      'Retsepti uuendamine ebaõnnestus',
    ],
  ])('renders the Estonian copy for a 500 on %s', async (_label, meal, serverError, expected) => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: serverError }),
    })
    const { result, onSuccess } = renderForm(meal)

    await submit(result)

    expect(result.current.error).toBe(expected)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../messages/en.json'
import { type CookQuestionAskInput, useCookQuestion } from './use-cook-question'

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(() => Promise.resolve()),
}))

import { track } from '@/lib/analytics'

/**
 * The recipe target (HON-1339): a household recipe opened from My recipes,
 * with no plan entry. The shared behaviour is tested on the entry target in
 * `use-cook-question.test.ts`.
 */

const errors = enMessages['meal-plan'].cookQuestion.errors

const mockFetch = vi.fn()
global.fetch = mockFetch

const STEPS = ['Boil the pasta.', 'Stir in the cream.']
const EQUIPMENT = ['Large pot']
const STEP_1 = { kind: 'step', index: 1 } as const

function question(overrides: Partial<CookQuestionAskInput> = {}): CookQuestionAskInput {
  return {
    subject: STEP_1,
    steps: STEPS,
    equipment: EQUIPMENT,
    question: 'What can I substitute here?',
    source: 'chip',
    ...overrides,
  }
}

function bodyOf(call: number) {
  return JSON.parse(mockFetch.mock.calls[call]?.[1]?.body as string)
}

describe('useCookQuestion for a recipe from My recipes', () => {
  let wrapper: ReturnType<typeof createQueryWrapper>['wrapper']

  beforeEach(() => {
    wrapper = createQueryWrapper().wrapper
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts to the recipe route with the servings on screen', async () => {
    mockFetch.mockResolvedValue(new Response('Use cream cheese.', { status: 200 }))
    const { result } = renderHook(() => useCookQuestion({ mealId: 'meal-1', servings: 2.5 }), {
      wrapper,
    })

    await act(async () => {
      await result.current.ask(question())
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/meals/meal-1/cook-question',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(bodyOf(0)).toEqual({
      subject: STEP_1,
      steps: STEPS,
      equipment: EQUIPMENT,
      question: 'What can I substitute here?',
      servings: 2.5,
    })
    expect(result.current.active?.answer).toBe('Use cream cheese.')
  })

  it('sends the servings the screen shows when the question is asked', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(new Response('Answer', { status: 200 })))
    const { result, rerender } = renderHook(
      ({ servings }) => useCookQuestion({ mealId: 'meal-1', servings }),
      { wrapper, initialProps: { servings: 2 } },
    )

    rerender({ servings: 6 })
    await act(async () => {
      await result.current.ask(question())
    })

    expect(bodyOf(0).servings).toBe(6)
  })

  it('sends the previous question and answer with a follow-up (HON-980)', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('Use cream cheese.', { status: 200 }))
      .mockResolvedValueOnce(new Response('Thin it with milk.', { status: 200 }))
    const { result } = renderHook(() => useCookQuestion({ mealId: 'meal-1', servings: 4 }), {
      wrapper,
    })

    await act(async () => {
      await result.current.ask(question())
    })
    await act(async () => {
      await result.current.ask(question({ question: 'Too thick?' }))
    })

    expect(bodyOf(1)).toMatchObject({
      question: 'Too thick?',
      servings: 4,
      previous: { question: 'What can I substitute here?', answer: 'Use cream cheese.' },
    })
  })

  it('fires cook_view:question_asked without a plan', async () => {
    mockFetch.mockResolvedValue(new Response('Answer', { status: 200 }))
    const { result } = renderHook(() => useCookQuestion({ mealId: 'meal-1', servings: 4 }), {
      wrapper,
    })

    await act(async () => {
      await result.current.ask(question())
    })

    expect(track).toHaveBeenCalledWith('cook_view:question_asked', {
      meal_id: 'meal-1',
      subject: 'step',
      subject_index: 1,
      source: 'chip',
      has_previous: false,
    })
  })

  it('renders catalog copy for meal_not_found, with no Retry', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Meal not found', code: 'meal_not_found' }),
    })
    const { result } = renderHook(() => useCookQuestion({ mealId: 'meal-1', servings: 4 }), {
      wrapper,
    })

    await act(async () => {
      await result.current.ask(question())
    })

    expect(result.current.error).toEqual({ message: errors.mealNotFound, canRetry: false })
    expect(result.current.error?.message).not.toContain('Meal not found')
  })
})

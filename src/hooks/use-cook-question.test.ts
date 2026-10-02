import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useCookQuestion, type CookQuestionAskInput } from './use-cook-question'
import enMessages from '../../messages/en.json'

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(() => Promise.resolve()),
}))

import { track } from '@/lib/analytics'

const errors = enMessages['meal-plan'].cookQuestion.errors

const mockFetch = vi.fn()
global.fetch = mockFetch

const options = { planId: 'plan-1', entryId: 'entry-1', mealId: 'meal-1' }

const STEPS = ['Boil the pasta.', 'Stir in the cream.']

function question(overrides: Partial<CookQuestionAskInput> = {}): CookQuestionAskInput {
  return {
    stepIndex: 1,
    steps: STEPS,
    question: 'What can I substitute here?',
    source: 'chip',
    ...overrides,
  }
}

function ok(answer: string) {
  return { ok: true, json: () => Promise.resolve({ answer }) }
}

function fail(status: number, body: Record<string, unknown>) {
  return { ok: false, status, json: () => Promise.resolve(body) }
}

describe('useCookQuestion', () => {
  let wrapper: ReturnType<typeof createQueryWrapper>['wrapper']

  beforeEach(() => {
    wrapper = createQueryWrapper().wrapper
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('posts the step, the steps and the question, and shows the answer', async () => {
    mockFetch.mockResolvedValue(ok('Use the yoghurt you have.'))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      await result.current.ask(question())
    })

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/meal-plans/plan-1/entries/entry-1/cook-question',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          stepIndex: 1,
          steps: STEPS,
          question: 'What can I substitute here?',
        }),
      }),
    )
    expect(result.current.active).toEqual({
      stepIndex: 1,
      question: 'What can I substitute here?',
      answer: 'Use the yoghurt you have.',
    })
    expect(result.current.isPending).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('fires cook_view:question_asked once per ask, with its source', async () => {
    mockFetch.mockResolvedValue(ok('Answer'))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      await result.current.ask(question({ source: 'text', stepIndex: 0 }))
    })

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('cook_view:question_asked', {
      plan_id: 'plan-1',
      meal_id: 'meal-1',
      step_index: 0,
      source: 'text',
    })
  })

  it('replaces the answer with a second question on the same step', async () => {
    mockFetch.mockResolvedValueOnce(ok('First')).mockResolvedValueOnce(ok('Second'))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      await result.current.ask(question())
    })
    await act(async () => {
      await result.current.ask(question({ question: "I'm short on time" }))
    })

    expect(result.current.active).toEqual({
      stepIndex: 1,
      question: "I'm short on time",
      answer: 'Second',
    })
  })

  it.each([
    ['rate_limited', 429, errors.rateLimited],
    ['ai_cap_exceeded', 429, errors.aiCapExceeded],
    ['generation_disabled', 503, errors.generationDisabled],
  ])('does not retry %s, and offers no Retry', async (code, status, message) => {
    mockFetch.mockResolvedValue(fail(status, { error: 'English', code }))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      await result.current.ask(question())
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.current.error).toEqual({ message, canRetry: false })
  })

  it('retries a 500 once and shows the answer', async () => {
    mockFetch
      .mockResolvedValueOnce(fail(500, { error: 'boom', code: 'question_failed' }))
      .mockResolvedValueOnce(ok('Answer'))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      const promise = result.current.ask(question())
      await vi.advanceTimersByTimeAsync(2000)
      await promise
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.current.active?.answer).toBe('Answer')
    expect(result.current.error).toBeNull()
  })

  it('does not auto-retry a timeout, but offers Retry with catalog copy', async () => {
    mockFetch.mockResolvedValue(fail(504, { error: 'Timed out', code: 'question_timeout' }))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      await result.current.ask(question())
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.current.error).toEqual({ message: errors.questionTimeout, canRetry: true })
  })

  it('retry sends the last question again without a second analytics event', async () => {
    mockFetch
      .mockResolvedValueOnce(fail(504, { error: 'Timed out', code: 'question_timeout' }))
      .mockResolvedValueOnce(ok('Answer'))
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    await act(async () => {
      await result.current.ask(question())
    })
    await act(async () => {
      await result.current.retry()
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1]?.[1]?.body).toBe(mockFetch.mock.calls[0]?.[1]?.body)
    expect(result.current.active?.answer).toBe('Answer')
    expect(track).toHaveBeenCalledTimes(1)
  })

  it('an aborted request writes nothing', async () => {
    let resolveFetch: (value: unknown) => void
    mockFetch.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          resolveFetch = resolve
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          )
        }),
    )
    const { result } = renderHook(() => useCookQuestion(options), { wrapper })

    let askPromise: Promise<void>
    act(() => {
      askPromise = result.current.ask(question())
    })
    expect(result.current.isPending).toBe(true)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())

    act(() => {
      result.current.reset()
    })

    await act(async () => {
      resolveFetch!(ok('Too late'))
      await askPromise
    })

    expect(result.current.active).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.isPending).toBe(false)
  })
})

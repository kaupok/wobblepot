import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { useCookQuestion, type CookQuestionAskInput } from './use-cook-question'
import { COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH } from '@/lib/ai/cook-question-limits'
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

/** The whole answer in one chunk, as a streamed text body. */
function ok(answer: string) {
  return new Response(answer, { status: 200 })
}

/** A streamed answer the test writes chunk by chunk (HON-979). */
function streamed() {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    response: new Response(body, { status: 200 }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
  }
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
      has_previous: false,
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

  describe('the answer on screen while the next one waits (HON-978)', () => {
    /** A fetch that waits until the test settles it. */
    function deferredFetch() {
      let settle: (value: unknown) => void = () => {}
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve
          }),
      )
      return (value: unknown) => settle(value)
    }

    async function answered(result: { current: ReturnType<typeof useCookQuestion> }) {
      mockFetch.mockResolvedValueOnce(ok('First'))
      await act(async () => {
        await result.current.ask(question())
      })
    }

    it('keeps the previous answer while pending, and the new answer replaces it', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await answered(result)
      expect(result.current.previous).toBeNull()

      const settle = deferredFetch()
      let askPromise: Promise<void>
      act(() => {
        askPromise = result.current.ask(question({ question: "I'm short on time" }))
      })

      expect(result.current.isPending).toBe(true)
      expect(result.current.active).toEqual({
        stepIndex: 1,
        question: "I'm short on time",
        answer: null,
      })
      expect(result.current.previous).toEqual({
        stepIndex: 1,
        question: 'What can I substitute here?',
        answer: 'First',
      })

      // The mutation reaches `fetch` a tick after `ask`.
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
      await act(async () => {
        settle(ok('Second'))
        await askPromise
      })

      expect(result.current.active?.answer).toBe('Second')
      expect(result.current.previous).toBeNull()
    })

    it('an error replaces the previous answer', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await answered(result)

      mockFetch.mockResolvedValueOnce(fail(504, { error: 'Timed out', code: 'question_timeout' }))
      await act(async () => {
        await result.current.ask(question({ question: "I'm short on time" }))
      })

      expect(result.current.previous).toBeNull()
      expect(result.current.error).toEqual({ message: errors.questionTimeout, canRetry: true })
    })

    it('reset drops the previous answer with the question', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await answered(result)

      deferredFetch()
      act(() => {
        void result.current.ask(question({ question: "I'm short on time" }))
      })
      expect(result.current.previous).not.toBeNull()

      act(() => {
        result.current.reset()
      })

      expect(result.current.previous).toBeNull()
      expect(result.current.active).toBeNull()
    })

    it("does not carry another step's answer", async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await answered(result)

      deferredFetch()
      act(() => {
        void result.current.ask(question({ stepIndex: 0 }))
      })

      expect(result.current.isPending).toBe(true)
      expect(result.current.previous).toBeNull()
    })
  })

  describe('the previous question and answer (HON-980)', () => {
    const FIRST = { question: 'What can I substitute here?', answer: 'Use the yoghurt.' }

    function bodyOf(call: number) {
      return JSON.parse(mockFetch.mock.calls[call]?.[1]?.body as string)
    }

    async function askAndAnswer(
      result: { current: ReturnType<typeof useCookQuestion> },
      input: Partial<CookQuestionAskInput>,
      answer: string,
    ) {
      mockFetch.mockResolvedValueOnce(ok(answer))
      await act(async () => {
        await result.current.ask(question(input))
      })
    }

    it('a second question on the same step sends the first question and its full answer', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      const stream = streamed()
      mockFetch.mockResolvedValueOnce(stream.response)
      await act(async () => {
        const promise = result.current.ask(question({ question: FIRST.question }))
        await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())
        stream.push('Use the ')
        stream.push('yoghurt.')
        stream.close()
        await promise
      })

      await askAndAnswer(result, { question: 'And if I have no oil?', source: 'text' }, 'Then…')

      expect(bodyOf(0)).not.toHaveProperty('previous')
      expect(bodyOf(1)).toEqual({
        stepIndex: 1,
        steps: STEPS,
        question: 'And if I have no oil?',
        previous: FIRST,
      })
      expect(track).toHaveBeenNthCalledWith(1, 'cook_view:question_asked', {
        plan_id: 'plan-1',
        meal_id: 'meal-1',
        step_index: 1,
        source: 'chip',
        has_previous: false,
      })
      expect(track).toHaveBeenNthCalledWith(2, 'cook_view:question_asked', {
        plan_id: 'plan-1',
        meal_id: 'meal-1',
        step_index: 1,
        source: 'text',
        has_previous: true,
      })
    })

    it('sends only the last answered question, not the one before it', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await askAndAnswer(result, { question: FIRST.question }, FIRST.answer)
      await askAndAnswer(result, { question: 'Second?' }, 'Second answer.')
      await askAndAnswer(result, { question: 'Third?' }, 'Third answer.')

      expect(bodyOf(2).previous).toEqual({ question: 'Second?', answer: 'Second answer.' })
    })

    it('clips a long answer to the limit the route accepts, keeping its start', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      const long = 'a'.repeat(COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH) + 'b'.repeat(300)
      await askAndAnswer(result, { question: FIRST.question }, long)
      await askAndAnswer(result, { question: 'And if I have no oil?' }, 'Then…')

      expect(bodyOf(1).previous).toEqual({
        question: FIRST.question,
        answer: 'a'.repeat(COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH),
      })
    })

    it('does not cut an emoji in half at the limit', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      // The emoji's two UTF-16 units sit at the limit's last unit and the one after it.
      const head = 'a'.repeat(COOK_QUESTION_PREVIOUS_ANSWER_MAX_LENGTH - 1)
      await askAndAnswer(result, { question: FIRST.question }, `${head}🔥 and more.`)
      await askAndAnswer(result, { question: 'And if I have no oil?' }, 'Then…')

      expect(bodyOf(1).previous.answer).toBe(head)
    })

    it('the first question on another step sends no previous', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await askAndAnswer(result, { question: FIRST.question }, FIRST.answer)
      await askAndAnswer(result, { stepIndex: 0 }, 'About step one.')

      expect(bodyOf(1)).not.toHaveProperty('previous')
      expect(track).toHaveBeenLastCalledWith(
        'cook_view:question_asked',
        expect.objectContaining({ step_index: 0, has_previous: false }),
      )
    })

    it('the first question after reset sends no previous', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await askAndAnswer(result, { question: FIRST.question }, FIRST.answer)
      act(() => {
        result.current.reset()
      })
      await askAndAnswer(result, { question: 'And if I have no oil?' }, 'Then…')

      expect(bodyOf(1)).not.toHaveProperty('previous')
    })

    it('does not send an answer whose stream broke', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      const stream = streamed()
      mockFetch.mockResolvedValueOnce(stream.response)
      let broken!: Promise<void>
      act(() => {
        broken = result.current.ask(question({ question: FIRST.question }))
      })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())
      act(() => stream.push('Use the '))
      await waitFor(() => expect(result.current.active?.answer).toBe('Use the '))
      await act(async () => {
        stream.fail(new TypeError('network error'))
        await broken
      })
      expect(result.current.error).not.toBeNull()

      await askAndAnswer(result, { question: 'And if I have no oil?' }, 'Then…')

      expect(bodyOf(1)).not.toHaveProperty('previous')
    })

    it('does not send an answer that a newer question cut off', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await askAndAnswer(result, { question: FIRST.question }, FIRST.answer)

      const stream = streamed()
      mockFetch.mockResolvedValueOnce(stream.response)
      let cutOff!: Promise<void>
      act(() => {
        cutOff = result.current.ask(question({ question: 'Second?' }))
      })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
      act(() => stream.push('Half an'))
      await waitFor(() => expect(result.current.active?.answer).toBe('Half an'))

      // The third fails, so nothing newer than the first is answered in full.
      mockFetch.mockResolvedValueOnce(fail(504, { error: 'Timed out', code: 'question_timeout' }))
      await act(async () => {
        await result.current.ask(question({ question: 'Third?' }))
        await cutOff
      })
      await askAndAnswer(result, { question: 'Fourth?' }, 'Fourth answer.')

      expect(bodyOf(2).previous).toEqual(FIRST)
      expect(bodyOf(3).previous).toEqual(FIRST)
    })

    it('retry resends the same previous', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      await askAndAnswer(result, { question: FIRST.question }, FIRST.answer)
      mockFetch
        .mockResolvedValueOnce(fail(504, { error: 'Timed out', code: 'question_timeout' }))
        .mockResolvedValueOnce(ok('Then…'))

      await act(async () => {
        await result.current.ask(question({ question: 'And if I have no oil?' }))
      })
      await act(async () => {
        await result.current.retry()
      })

      expect(bodyOf(1).previous).toEqual(FIRST)
      expect(bodyOf(2)).toEqual(bodyOf(1))
    })
  })

  describe('the answer streams in (HON-979)', () => {
    async function asking(result: { current: ReturnType<typeof useCookQuestion> }) {
      const stream = streamed()
      mockFetch.mockResolvedValueOnce(stream.response)
      let askPromise!: Promise<void>
      act(() => {
        askPromise = result.current.ask(question())
      })
      await waitFor(() => expect(mockFetch).toHaveBeenCalled())
      return { ...stream, askPromise }
    }

    it('grows the answer chunk by chunk; pending ends at the first, streaming at close', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      const stream = await asking(result)
      expect(result.current.isPending).toBe(true)
      expect(result.current.isStreaming).toBe(false)

      act(() => stream.push('Use the '))
      await waitFor(() => expect(result.current.active?.answer).toBe('Use the '))
      expect(result.current.isPending).toBe(false)
      expect(result.current.isStreaming).toBe(true)

      act(() => stream.push('yoghurt.'))
      await waitFor(() => expect(result.current.active?.answer).toBe('Use the yoghurt.'))
      expect(result.current.isStreaming).toBe(true)

      await act(async () => {
        stream.close()
        await stream.askPromise
      })
      await waitFor(() => expect(result.current.isStreaming).toBe(false))
      expect(result.current.isPending).toBe(false)
      expect(result.current.error).toBeNull()
    })

    it('keeps the words that arrived when the stream breaks, with Retry and no auto-retry', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      const stream = await asking(result)

      act(() => stream.push('Use the '))
      await waitFor(() => expect(result.current.active?.answer).toBe('Use the '))
      await act(async () => {
        stream.fail(new TypeError('network error'))
        await vi.advanceTimersByTimeAsync(2000)
        await stream.askPromise
      })

      expect(result.current.active?.answer).toBe('Use the ')
      expect(result.current.error).toEqual({ message: errors.questionFailed, canRetry: true })
      expect(result.current.isStreaming).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('an empty answer is an error, not a blank answer', async () => {
      mockFetch.mockResolvedValueOnce(ok(''))
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })

      await act(async () => {
        await result.current.ask(question())
      })

      expect(result.current.active?.answer).toBeNull()
      expect(result.current.error).toEqual({ message: errors.questionFailed, canRetry: true })
    })

    it('reset mid-stream stops the read and writes nothing more', async () => {
      const { result } = renderHook(() => useCookQuestion(options), { wrapper })
      const stream = await asking(result)
      act(() => stream.push('Use the '))
      await waitFor(() => expect(result.current.active?.answer).toBe('Use the '))

      act(() => {
        result.current.reset()
      })
      await act(async () => {
        await stream.askPromise
      })

      expect(result.current.active).toBeNull()
      expect(result.current.error).toBeNull()
      expect(result.current.isStreaming).toBe(false)
      // The body was cancelled, so no further chunk can be written.
      expect(() => stream.push('yoghurt.')).toThrow()
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

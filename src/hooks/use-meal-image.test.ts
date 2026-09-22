import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import {
  MEAL_IMAGE_PLACEHOLDER_DELAY_MS,
  MEAL_IMAGE_POLL_INTERVAL_MS,
  MEAL_IMAGE_POLL_TIMEOUT_MS,
  mealImageQueryKey,
  useMealImage,
  useMealImageFields,
} from './use-meal-image'
import type { MealData } from '@/components/meal-plan/types'

type Meal = Pick<MealData, 'id' | 'isCustom' | 'imageUrl' | 'imageStatus' | 'imageHue'>

const URL_1 = 'https://store.public.blob.vercel-storage.com/meals/meal-1.png'
const URL_2 = 'https://store.public.blob.vercel-storage.com/meals/meal-2.png'

const householdMeal: Meal = { id: 'meal-1', isCustom: true, imageStatus: 'none', imageUrl: null }
const globalMeal: Meal = { id: 'meal-g', isCustom: false, imageStatus: 'none', imageUrl: null }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch whose answer the test releases by hand, and which honours its abort signal. */
function deferred() {
  let resolve!: (response: Response) => void
  const calls: { signal?: AbortSignal | null }[] = []
  const impl = (_url: string, init?: RequestInit) =>
    new Promise<Response>((res, rej) => {
      calls.push({ signal: init?.signal })
      resolve = res
      init?.signal?.addEventListener('abort', () =>
        rej(new DOMException('The operation was aborted.', 'AbortError')),
      )
    })
  return { impl, calls, resolve: (response: Response) => resolve(response) }
}

const mockFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
const posts = () => mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST')
const gets = () => mockFetch.mock.calls.filter(([, init]) => init?.method !== 'POST')

function renderImageHook(initial: { meal: Meal; open: boolean }) {
  const { wrapper } = createQueryWrapper()
  return renderHook((props: { meal: Meal; open: boolean }) => useMealImage(props), {
    wrapper,
    initialProps: initial,
  })
}

describe('useMealImageFields', () => {
  it('passes the payload through while there is no image state for the meal', () => {
    const { wrapper } = createQueryWrapper()
    const meal = { ...householdMeal, name: 'Soup' }
    const { result } = renderHook(() => useMealImageFields(meal), { wrapper })

    expect(result.current).toBe(meal)
  })

  it('takes an image generated from the modal over the stale payload', async () => {
    const { wrapper, queryClient } = createQueryWrapper()
    const meal = { ...householdMeal, name: 'Soup' }
    const { result } = renderHook(() => useMealImageFields(meal), { wrapper })

    act(() => {
      queryClient.setQueryData(mealImageQueryKey('meal-1'), {
        status: 'ready',
        imageUrl: URL_1,
        imageHue: 40,
      })
    })

    await waitFor(() =>
      expect(result.current).toEqual({
        ...meal,
        imageStatus: 'ready',
        imageUrl: URL_1,
        imageHue: 40,
      }),
    )
  })

  it('never fetches on its own', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { wrapper } = createQueryWrapper()
    renderHook(() => useMealImageFields(householdMeal), { wrapper })

    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('returns null for an empty slot', () => {
    const { wrapper } = createQueryWrapper()
    const { result } = renderHook(() => useMealImageFields(null), { wrapper })

    expect(result.current).toBeNull()
  })
})

describe('useMealImage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('seeds the state from the meal payload', () => {
    const { result } = renderImageHook({
      meal: { ...householdMeal, imageStatus: 'ready', imageUrl: URL_1 },
      open: false,
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.imageUrl).toBe(URL_1)
  })

  it('carries the hue from the payload and from a generated image', async () => {
    const { result } = renderImageHook({
      meal: { ...householdMeal, imageStatus: 'ready', imageUrl: URL_1, imageHue: 52 },
      open: false,
    })
    expect(result.current.imageHue).toBe(52)

    mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_2, imageHue: 264 }))
    const generated = renderImageHook({ meal: { ...householdMeal, id: 'meal-2' }, open: true })
    await waitFor(() => expect(generated.result.current.imageHue).toBe(264))
  })

  it('fires exactly one POST when a household meal without an image opens', async () => {
    mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_1 }))
    const { result, rerender } = renderImageHook({ meal: householdMeal, open: true })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.imageUrl).toBe(URL_1)
    expect(posts()).toHaveLength(1)
    expect(posts()[0]?.[0]).toBe('/api/meals/meal-1/image')

    // Closing and reopening does not ask again.
    rerender({ meal: householdMeal, open: false })
    rerender({ meal: householdMeal, open: true })
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries a failed image once per open session', async () => {
    mockFetch.mockResolvedValue(json({ status: 'failed' }))
    const { result } = renderImageHook({
      meal: { ...householdMeal, imageStatus: 'failed' },
      open: true,
    })

    await waitFor(() => expect(posts()).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(result.current.status).toBe('failed')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('never fires for a global meal', async () => {
    renderImageHook({ meal: globalMeal, open: true })

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('never fires while the modal is closed', async () => {
    renderImageHook({ meal: householdMeal, open: false })

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('never fires for a meal that already has its image', async () => {
    renderImageHook({
      meal: { ...householdMeal, imageStatus: 'ready', imageUrl: URL_1 },
      open: true,
    })

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [503, 'Meal images are not available'],
    [429, 'Rate limit exceeded'],
    [429, 'AI usage limit reached'],
    [500, "Couldn't generate the image."],
  ])('stays silent on a %i (%s) and shows no image', async (status, error) => {
    mockFetch.mockResolvedValue(json({ error }, status))
    const { result } = renderImageHook({ meal: householdMeal, open: true })

    await waitFor(() => expect(posts()).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(result.current.status).toBe('none')
    expect(result.current.imageUrl).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('never shows the reserved box for an answer that comes back fast', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Meal images are not available' }, 503))
    const seen: string[] = []
    const { wrapper } = createQueryWrapper()
    renderHook(
      () => {
        const state = useMealImage({ meal: householdMeal, open: true })
        seen.push(state.status)
        return state
      },
      { wrapper },
    )

    await waitFor(() => expect(posts()).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_PLACEHOLDER_DELAY_MS * 2))
    expect(seen).not.toContain('generating')
  })

  it('reserves the box while a generation is running, then shows the image', async () => {
    const post = deferred()
    mockFetch.mockImplementation(post.impl)
    const { result } = renderImageHook({ meal: householdMeal, open: true })

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(result.current.status).toBe('none')

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_PLACEHOLDER_DELAY_MS))
    expect(result.current.status).toBe('generating')

    // Its own request is still out, so nothing polls behind it.
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 3))
    expect(gets()).toHaveLength(0)

    await act(async () => post.resolve(json({ status: 'ready', imageUrl: URL_1 })))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.imageUrl).toBe(URL_1)
  })

  it('polls the stored state every 5 s after a 202, until the image is ready', async () => {
    let reads = 0
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') return json({ status: 'generating' }, 202)
      reads += 1
      return reads < 3 ? json({ status: 'generating' }) : json({ status: 'ready', imageUrl: URL_1 })
    })
    const { result } = renderImageHook({ meal: householdMeal, open: true })

    await waitFor(() => expect(result.current.status).toBe('generating'))
    expect(gets()).toHaveLength(0)

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS))
    expect(gets()).toHaveLength(1)
    expect(gets()[0]?.[0]).toBe('/api/meals/meal-1/image')

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.imageUrl).toBe(URL_1)

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 3))
    expect(gets()).toHaveLength(3)
    expect(posts()).toHaveLength(1)
  })

  it('gives up silently after 90 s of polling and removes the box', async () => {
    mockFetch.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? json({ status: 'generating' }, 202)
        : json({ status: 'generating' }),
    )
    const { result } = renderImageHook({ meal: householdMeal, open: true })
    await waitFor(() => expect(result.current.status).toBe('generating'))

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_TIMEOUT_MS - 1_000))
    expect(result.current.status).toBe('generating')

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS))
    await waitFor(() => expect(result.current.status).toBe('none'))
    const readsAtGiveUp = gets().length
    expect(readsAtGiveUp).toBeLessThanOrEqual(
      MEAL_IMAGE_POLL_TIMEOUT_MS / MEAL_IMAGE_POLL_INTERVAL_MS,
    )

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 4))
    expect(gets()).toHaveLength(readsAtGiveUp)
    expect(posts()).toHaveLength(1)
  })

  it('asks once for a meal that arrives generating, then polls after the 202', async () => {
    mockFetch.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? json({ status: 'generating' }, 202)
        : json({ status: 'ready', imageUrl: URL_1 }),
    )
    const { result } = renderImageHook({
      meal: { ...householdMeal, imageStatus: 'generating' },
      open: true,
    })

    await waitFor(() => expect(posts()).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(posts()).toHaveLength(1)
  })

  it('lets the POST take over a generation whose function died', async () => {
    // The route reclaims a claim older than 3 minutes and draws the image.
    mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_1 }))
    const { result } = renderImageHook({
      meal: { ...householdMeal, imageStatus: 'generating' },
      open: true,
    })

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(posts()).toHaveLength(1)
  })

  it('drops the box, rather than restoring it, when a generating meal’s POST fails', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Meal images are not available' }, 503))
    const { result } = renderImageHook({
      meal: { ...householdMeal, imageStatus: 'generating' },
      open: true,
    })

    await waitFor(() => expect(posts()).toHaveLength(1))
    await waitFor(() => expect(result.current.status).toBe('none'))
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS * 2))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('polls a global meal the batch is generating, without a POST', async () => {
    mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_1 }))
    const { result } = renderImageHook({
      meal: { ...globalMeal, imageStatus: 'generating' },
      open: true,
    })

    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(posts()).toHaveLength(0)
  })

  it('takes a changed server payload over the cache, and asks again after an edit', async () => {
    const readyMeal: Meal = { ...householdMeal, imageStatus: 'ready', imageUrl: URL_1 }
    const { result, rerender } = renderImageHook({ meal: readyMeal, open: false })
    expect(result.current.imageUrl).toBe(URL_1)

    // The meal was edited: the server cleared the image and deleted its blob.
    mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_2 }))
    rerender({ meal: householdMeal, open: false })
    await waitFor(() => expect(result.current.status).toBe('none'))
    expect(result.current.imageUrl).toBeNull()

    rerender({ meal: householdMeal, open: true })
    await waitFor(() => expect(result.current.imageUrl).toBe(URL_2))
    expect(posts()).toHaveLength(1)
  })

  it.each([
    ['failed', json({ error: "Couldn't generate the image." }, 500)],
    ['generating', json({ status: 'generating' }, 202)],
  ] as const)(
    'does not re-POST when a refresh reports this session’s own %s',
    async (refreshed, answer) => {
      mockFetch.mockResolvedValue(answer)
      const { result, rerender } = renderImageHook({ meal: householdMeal, open: true })
      await waitFor(() => expect(posts()).toHaveLength(1))

      // Ticking an ingredient calls router.refresh(), which re-sends the row.
      mockFetch.mockResolvedValue(json({ status: 'generating' }))
      rerender({ meal: { ...householdMeal, imageStatus: refreshed }, open: true })
      await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_TIMEOUT_MS * 2))

      expect(posts()).toHaveLength(1)
      expect(result.current.status).not.toBe('ready')
    },
  )

  it('applies an edited meal’s none over a cached ready left by an earlier mount', async () => {
    const { wrapper, queryClient } = createQueryWrapper()
    queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 5 * 60_000 } })
    const first = renderHook((props: { meal: Meal; open: boolean }) => useMealImage(props), {
      wrapper,
      initialProps: {
        meal: { ...householdMeal, imageStatus: 'ready', imageUrl: URL_1 },
        open: false,
      },
    })
    first.unmount()

    // Edited on /recipes/[id]/edit, then back: the page now says `none`.
    mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_2 }))
    const { result } = renderHook((props: { meal: Meal; open: boolean }) => useMealImage(props), {
      wrapper,
      initialProps: { meal: householdMeal, open: true },
    })

    await waitFor(() => expect(result.current.imageUrl).toBe(URL_2))
    expect(posts()).toHaveLength(1)
  })

  it('asks again when a poll reads none, because an edit reset the row under the claim', async () => {
    let postCount = 0
    mockFetch.mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        postCount += 1
        return postCount === 1
          ? json({ status: 'generating' }, 202)
          : json({ status: 'ready', imageUrl: URL_2 })
      }
      return json({ status: 'none' })
    })
    const { result } = renderImageHook({ meal: householdMeal, open: true })

    await waitFor(() => expect(result.current.status).toBe('generating'))
    await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS))

    await waitFor(() => expect(result.current.imageUrl).toBe(URL_2))
    expect(posts()).toHaveLength(2)
  })

  describe('swapping the meal mid-request (HON-682)', () => {
    it('never shows the previous meal’s image when its answer lands after the swap', async () => {
      const post = deferred()
      mockFetch.mockImplementation(post.impl)
      const { result, rerender } = renderImageHook({ meal: householdMeal, open: true })
      await waitFor(() => expect(posts()).toHaveLength(1))

      // The entry now points at a global meal with no image; the old request is still out.
      rerender({ meal: globalMeal, open: true })
      await act(async () => post.resolve(json({ status: 'ready', imageUrl: URL_1 })))
      await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_POLL_INTERVAL_MS))

      expect(result.current.status).toBe('none')
      expect(result.current.imageUrl).toBeNull()
    })

    it('aborts the request on cancelImage, then serves the new meal', async () => {
      const post = deferred()
      mockFetch.mockImplementation(post.impl)
      const { result, rerender } = renderImageHook({ meal: householdMeal, open: true })
      await waitFor(() => expect(posts()).toHaveLength(1))
      await act(() => vi.advanceTimersByTimeAsync(MEAL_IMAGE_PLACEHOLDER_DELAY_MS))
      expect(result.current.status).toBe('generating')

      act(() => result.current.cancelImage())
      expect(post.calls[0]?.signal?.aborted).toBe(true)

      mockFetch.mockResolvedValue(json({ status: 'ready', imageUrl: URL_2 }))
      rerender({ meal: { ...householdMeal, id: 'meal-2' }, open: true })

      await waitFor(() => expect(result.current.imageUrl).toBe(URL_2))
      expect(posts()[1]?.[0]).toBe('/api/meals/meal-2/image')

      // Swapping back shows meal-1 as it was before its request, not generating.
      rerender({ meal: householdMeal, open: true })
      expect(result.current.status).toBe('none')
      expect(result.current.imageUrl).toBeNull()
    })

    it('renders the new meal’s payload when the card’s observer created its entry first', () => {
      // `MealCard` calls `useMealImageFields` before rendering the modal, so on
      // a swap the new meal's cache entry exists without data by the time this
      // hook switches keys — which used to throw on `data.status`.
      const { wrapper } = createQueryWrapper()
      const swapped: Meal = { ...globalMeal, imageStatus: 'ready', imageUrl: URL_2, imageHue: 30 }
      const { result, rerender } = renderHook(
        (props: { meal: Meal }) => {
          useMealImageFields(props.meal)
          return useMealImage({ meal: props.meal, open: false })
        },
        { wrapper, initialProps: { meal: householdMeal } },
      )

      rerender({ meal: swapped })

      expect(result.current.status).toBe('ready')
      expect(result.current.imageUrl).toBe(URL_2)
      expect(result.current.imageHue).toBe(30)
    })
  })
})

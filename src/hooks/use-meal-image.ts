'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { MealData } from '@/components/meal-plan/types'
import type { MealImageStatus } from '@/generated/prisma/enums'

export interface MealImageState {
  status: MealImageStatus
  imageUrl: string | null
}

/** How often a `generating` image is re-read while the modal is open. */
export const MEAL_IMAGE_POLL_INTERVAL_MS = 5_000
/** Polling gives up silently after this long, and the reserved box goes away. */
export const MEAL_IMAGE_POLL_TIMEOUT_MS = 90_000
/**
 * The POST is held open for the whole generation (~18 s), so the reserved box
 * is shown only once it has been pending this long. The answers that come back
 * fast — cached `ready`, 503 without a key, 429, over the cap — then never
 * flash a box that disappears a moment later.
 */
export const MEAL_IMAGE_PLACEHOLDER_DELAY_MS = 1_000

export const mealImageQueryKey = (mealId: string) => ['meal-image', mealId] as const

const GAVE_UP: MealImageState = { status: 'none', imageUrl: null }

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

const normalise = (body: {
  status: MealImageStatus
  imageUrl?: string | null
}): MealImageState => ({
  status: body.status,
  imageUrl: body.status === 'ready' ? (body.imageUrl ?? null) : null,
})

interface UseMealImageOptions {
  meal: Pick<MealData, 'id' | 'isCustom' | 'imageUrl' | 'imageStatus'>
  /** Whether the meal detail modal is open. Nothing is fetched while closed. */
  open: boolean
}

/**
 * The meal detail modal's hero illustration (HON-737).
 *
 * Opening a household-owned meal that has no image fires one
 * `POST /api/meals/{id}/image`, which generates it (or, for a meal already
 * `generating`, answers 202 or takes over a dead claim). A global meal never does:
 * the operator batch draws those (HON-738). While another request holds the
 * claim, the stored state is re-read every 5 s for at most 90 s.
 *
 * Everything is keyed by meal id, never entry id: a swap keeps the entry id
 * (HON-682), so a response for the previous meal can only ever land in that
 * meal's cache entry. `cancelImage` additionally aborts it, like `cancelTips`.
 *
 * Every failure is silent — the modal simply has no image. An image is
 * decoration and must never interrupt cooking.
 */
export function useMealImage({ meal, open }: UseMealImageOptions) {
  const queryClient = useQueryClient()
  const mealId = meal.id
  const attemptedRef = useRef(new Set<string>())
  const deadlinesRef = useRef(new Map<string, number>())
  const abortRef = useRef<AbortController | null>(null)

  const mutation = useMutation({
    mutationFn: ({ mealId, signal }: { mealId: string; signal: AbortSignal }) =>
      apiFetch<MealImageState>(`/api/meals/${mealId}/image`, { method: 'POST', signal }),
    onMutate: ({ mealId }) => {
      const key = mealImageQueryKey(mealId)
      const snapshot = queryClient.getQueryData<MealImageState>(key)
      const placeholderTimer = setTimeout(() => {
        queryClient.setQueryData<MealImageState>(key, { status: 'generating', imageUrl: null })
      }, MEAL_IMAGE_PLACEHOLDER_DELAY_MS)
      return { snapshot, placeholderTimer }
    },
    onSuccess: async (body, { mealId }) => {
      const key = mealImageQueryKey(mealId)
      if (body.status === 'generating') {
        deadlinesRef.current.set(mealId, Date.now() + MEAL_IMAGE_POLL_TIMEOUT_MS)
      }
      // A poll read before this request committed would otherwise land after
      // it and put the box back over the image for one interval.
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<MealImageState>(key, normalise(body))
    },
    // No toast, whatever the status: 503 without a key, 429, over the cap.
    // A meal that was already `generating` goes to nothing rather than back to
    // the box, which would otherwise sit there for the whole poll budget.
    onError: (_error, { mealId }, context) => {
      if (!context) return
      const restored = context.snapshot?.status === 'generating' ? GAVE_UP : context.snapshot
      queryClient.setQueryData(mealImageQueryKey(mealId), restored)
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context) clearTimeout(context.placeholderTimer)
    },
  })

  const { data } = useQuery({
    queryKey: mealImageQueryKey(mealId),
    queryFn: async ({ signal }): Promise<MealImageState> => {
      // The first poll fires one interval after polling starts, which is when
      // a meal that arrived already `generating` gets its deadline.
      let deadline = deadlinesRef.current.get(mealId)
      if (deadline === undefined) {
        deadline = Date.now() + MEAL_IMAGE_POLL_TIMEOUT_MS - MEAL_IMAGE_POLL_INTERVAL_MS
        deadlinesRef.current.set(mealId, deadline)
      }
      try {
        const next = normalise(
          await apiFetch<MealImageState>(`/api/meals/${mealId}/image`, { signal }),
        )
        // `none` mid-poll means the row was reset under the claim — a meal
        // edit — so the POST may ask again; only it ever claims.
        if (next.status === 'none') attemptedRef.current.delete(mealId)
        if (next.status !== 'generating' || Date.now() < deadline) return next
      } catch (error) {
        if (isAbort(error)) throw error
      }
      // Given up, or the read failed: drop the box, and never re-POST on reopen.
      attemptedRef.current.add(mealId)
      return GAVE_UP
    },
    initialData: normalise({ status: meal.imageStatus ?? 'none', imageUrl: meal.imageUrl }),
    // Only the poll below reads; the payload seeded the rest.
    staleTime: Infinity,
    retry: false,
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.status === 'generating' && !mutation.isPending
        ? MEAL_IMAGE_POLL_INTERVAL_MS
        : false,
  })

  const status = data.status
  const { mutate } = mutation

  // `initialData` only seeds an empty cache entry, and `MealCard` keeps this
  // modal mounted for the whole session — so without this, a meal edit that
  // cleared the image (and deleted its blob) would keep the old `ready` URL
  // here forever. The first render is skipped: the cache can hold a newer
  // answer from this session than the payload the page was rendered with —
  // except for `none`, below.
  //
  // Only `none` re-arms the POST, because that is what an edit resets the
  // image to (`clearMealImage`). Any `router.refresh()` — ticking an
  // ingredient does one — also delivers a new payload, and a `failed` or
  // `generating` there is usually this session's own attempt coming back:
  // re-asking would pay for another generation, or restart the poll after
  // it gave up.
  const payloadStatus = meal.imageStatus ?? 'none'
  const payloadUrl = meal.imageUrl ?? null
  const payloadKey = `${mealId}|${payloadStatus}|${payloadUrl}`
  // A `none` payload is applied on the first render too: only an edit resets
  // the image to `none`, and the cache entry can outlive this hook by
  // `gcTime` — an edit on another page, then back, would otherwise keep
  // showing the deleted blob.
  const lastPayloadKeyRef = useRef(payloadStatus === 'none' ? null : payloadKey)
  useEffect(() => {
    if (lastPayloadKeyRef.current === payloadKey) return
    lastPayloadKeyRef.current = payloadKey
    if (payloadStatus === 'none') {
      attemptedRef.current.delete(mealId)
      deadlinesRef.current.delete(mealId)
    } else if (payloadStatus !== 'ready' && attemptedRef.current.has(mealId)) {
      return
    }
    queryClient.setQueryData<MealImageState>(
      mealImageQueryKey(mealId),
      normalise({ status: payloadStatus, imageUrl: payloadUrl }),
    )
  }, [payloadKey, mealId, payloadStatus, payloadUrl, queryClient])

  // Fired by the modal opening rather than by a click: `MealCard` owns `open`,
  // so this is the one place that sees it change. It is a write, not a read.
  //
  // `generating` asks too: only the POST takes over a claim whose function
  // died (older than 3 minutes). For a live claim it answers 202 cheaply,
  // without spending a rate-limit token, and the poll below takes over.
  useEffect(() => {
    if (!open || !meal.isCustom) return
    if (status === 'ready') return
    if (attemptedRef.current.has(mealId)) return
    attemptedRef.current.add(mealId)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    mutate({ mealId, signal: controller.signal })
  }, [open, meal.isCustom, status, mealId, mutate])

  /**
   * Stop any image request still running for this meal, for a caller that has
   * just repointed the entry at a different meal (HON-682). Aborting first
   * makes the mutation roll its own meal's cache entry back instead of
   * resolving into it.
   */
  const cancelImage = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    void queryClient.cancelQueries({ queryKey: mealImageQueryKey(mealId) })
  }, [queryClient, mealId])

  return { status, imageUrl: data.imageUrl, cancelImage }
}

'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { MealImageFields } from '@/components/meal-plan/MealImageCard'
import {
  MEAL_IMAGE_POLL_INTERVAL_MS,
  MEAL_IMAGE_POLL_TIMEOUT_MS,
  type MealImageState,
} from '@/hooks/use-meal-image'

type CardImageFields = Pick<MealImageFields, 'imageStatus' | 'imageUrl' | 'imageHue'>

const GAVE_UP: CardImageFields = { imageStatus: 'none', imageUrl: null, imageHue: null }

/**
 * The image fields a My recipes card renders with (HON-1364). Saving a recipe
 * starts its image on the server, so a new card arrives `generating`. While
 * it does, this re-reads `GET /api/meals/{id}/image` every 5 s, for at most
 * 90 s, and hands back the image once it is ready. Past the deadline, or on a
 * failed read, the card drops the box and shows no image.
 *
 * Any other status is the payload's, as it is. The key is the card's own,
 * not the cook view's `['meal-image', id]` and not under it, so the cook
 * view's cancels miss it: that entry can outlive an edit, and the payload is
 * what says a new image is being drawn. `gcTime: 0` drops it with the card,
 * so a remount starts from the payload again.
 */
export function useRecipeCardImage<T extends { id: string } & CardImageFields>(meal: T): T {
  const generating = meal.imageStatus === 'generating'
  const deadlineRef = useRef<number | null>(null)

  const { data } = useQuery({
    queryKey: ['recipe-card-image', meal.id],
    queryFn: async ({ signal }): Promise<CardImageFields> => {
      deadlineRef.current ??= Date.now() + MEAL_IMAGE_POLL_TIMEOUT_MS
      try {
        const body = await apiFetch<MealImageState>(`/api/meals/${meal.id}/image`, { signal })
        if (body.status === 'ready' && body.imageUrl) {
          return { imageStatus: 'ready', imageUrl: body.imageUrl, imageHue: body.imageHue ?? null }
        }
        if (body.status === 'generating' && Date.now() < deadlineRef.current) {
          return { imageStatus: 'generating', imageUrl: null, imageHue: null }
        }
      } catch {
        // An image is decoration: a failed read only drops the box.
      }
      return GAVE_UP
    },
    enabled: generating,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.imageStatus === 'generating' ? MEAL_IMAGE_POLL_INTERVAL_MS : false,
  })

  if (!generating || !data) return meal
  return { ...meal, ...data }
}

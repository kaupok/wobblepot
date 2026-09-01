'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { MealForm, type MealFormData } from '@/components/household/MealForm'
import { Body } from '@/components/ui/typography'
import { ApiError, apiFetch } from '@/lib/api'

const isClientError = (error: ApiError) => error.status >= 400 && error.status < 500

interface EditRecipeClientProps {
  mealId: string
}

export function EditRecipeClient({ mealId }: EditRecipeClientProps) {
  const router = useRouter()
  const t = useTranslations('recipes.edit')

  const {
    data: meal,
    isPending,
    error,
  } = useQuery({
    queryKey: ['meal', mealId],
    // MealForm seeds every field from `meal` in `useState` initialisers, so a
    // background refetch can't repair a stale first render. Dropping the entry
    // on unmount keeps a re-opened edit page from serving the pre-save meal
    // for the client's 60 s `staleTime` — and then PATCHing it back on save.
    gcTime: 0,
    // The route returns a superset of the form's fields (nutrition, favourite
    // flag, timestamps); `select` picks out the ones the form owns.
    queryFn: () => apiFetch<MealFormData>(`/api/households/me/meals/${mealId}`),
    // A 404 (or any 4xx) is an answer, not a transient failure — retrying it
    // just delays the "meal not found" copy behind three round trips.
    retry: (failureCount, err) =>
      !(err instanceof ApiError && isClientError(err)) && failureCount < 2,
    select: (data): MealFormData => ({
      id: data.id,
      name: data.name,
      description: data.description,
      preparationNotes: data.preparationNotes,
      sourceUrl: data.sourceUrl,
      timeMinutes: data.timeMinutes,
      kidFriendly: data.kidFriendly,
      suitableFor: data.suitableFor,
      servings: data.servings,
      components: data.components,
    }),
  })

  const handleSuccess = () => {
    router.push('/recipes')
  }

  const handleCancel = () => {
    router.push('/recipes')
  }

  // `isPending` rather than `isLoading`: a fetch paused by the browser being
  // offline is still pending but not fetching, and must not fall through to the
  // error branch below.
  if (isPending) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (error || !meal) {
    const isNotFound = error instanceof ApiError && error.status === 404
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <Body variant="muted">{isNotFound ? t('mealNotFound') : t('loadFailed')}</Body>
          <Button asChild variant="outline">
            <Link href="/recipes">{t('backToRecipes')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <MealForm meal={meal} onSuccess={handleSuccess} onCancel={handleCancel} />
    </div>
  )
}

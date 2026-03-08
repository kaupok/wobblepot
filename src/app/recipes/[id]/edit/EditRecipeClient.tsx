'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MealForm, type MealFormData } from '@/components/household/MealForm'
import { Body } from '@/components/ui/typography'

interface EditRecipeClientProps {
  mealId: string
}

export function EditRecipeClient({ mealId }: EditRecipeClientProps) {
  const router = useRouter()
  const [meal, setMeal] = useState<MealFormData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchMeal() {
      try {
        const response = await fetch(`/api/households/me/meals/${mealId}`)
        if (!response.ok) {
          if (response.status === 404) {
            setError('Meal not found')
            return
          }
          throw new Error('Failed to fetch meal')
        }
        const data = await response.json()
        setMeal({
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
        })
      } catch {
        setError('Failed to load meal')
        toast.error('Failed to load meal')
      } finally {
        setIsLoading(false)
      }
    }

    fetchMeal()
  }, [mealId])

  const handleSuccess = () => {
    router.push('/recipes')
  }

  const handleCancel = () => {
    router.push('/recipes')
  }

  if (isLoading) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (error || !meal) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <Body variant="muted">{error || 'Meal not found'}</Body>
          <Button asChild variant="outline">
            <Link href="/recipes">Back to recipes</Link>
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

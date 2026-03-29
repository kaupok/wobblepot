'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Plus, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { MealList, type MealData } from '@/components/household/MealList'

export function RecipesPageClient() {
  const [meals, setMeals] = useState<MealData[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchMeals = useCallback(async () => {
    try {
      const response = await fetch('/api/households/me/meals')
      if (!response.ok) {
        throw new Error('Failed to fetch meals')
      }
      const data = await response.json()
      setMeals(data.meals)
    } catch {
      toast.error('Failed to load meals')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMeals()
  }, [fetchMeals])

  const handleDelete = (mealId: string) => {
    setMeals(meals.filter((m) => m.id !== mealId))
  }

  const handleToggleFavorite = (mealId: string, isFavorite: boolean) => {
    setMeals(meals.map((m) => (m.id === mealId ? { ...m, isFavorite } : m)))
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <Heading variant="h4">My recipes</Heading>
          <Body variant="muted">Create and manage your household&apos;s custom recipes</Body>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <Body variant="muted">
                {isLoading
                  ? 'Loading...'
                  : `${meals.length} recipe${meals.length === 1 ? '' : 's'}`}
              </Body>
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link href="/recipes/imagine">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Imagine a meal
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/recipes/import">
                    <Plus className="mr-2 h-4 w-4" />
                    Add recipe
                  </Link>
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <MealList
                meals={meals}
                onDelete={handleDelete}
                onToggleFavorite={handleToggleFavorite}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

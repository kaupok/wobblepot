'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { MealForm } from '@/components/household/MealForm'
import { MealList, type MealData } from '@/components/household/MealList'

type ViewMode = 'list' | 'create' | 'edit'

export function RecipesPageClient() {
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [meals, setMeals] = useState<MealData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingMeal, setEditingMeal] = useState<MealData | null>(null)

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

  const handleCreateSuccess = () => {
    setViewMode('list')
    fetchMeals()
  }

  const handleEditSuccess = () => {
    setViewMode('list')
    setEditingMeal(null)
    fetchMeals()
  }

  const handleEdit = (meal: MealData) => {
    setEditingMeal(meal)
    setViewMode('edit')
  }

  const handleDelete = (mealId: string) => {
    setMeals(meals.filter((m) => m.id !== mealId))
  }

  const handleToggleFavorite = (mealId: string, isFavorite: boolean) => {
    setMeals(meals.map((m) => (m.id === mealId ? { ...m, isFavorite } : m)))
  }

  const handleCancel = () => {
    setViewMode('list')
    setEditingMeal(null)
  }

  // Show form view
  if (viewMode === 'create') {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <MealForm onSuccess={handleCreateSuccess} onCancel={handleCancel} />
      </div>
    )
  }

  if (viewMode === 'edit' && editingMeal) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <MealForm
          meal={{
            id: editingMeal.id,
            name: editingMeal.name,
            description: editingMeal.description,
            timeMinutes: editingMeal.timeMinutes,
            kidFriendly: editingMeal.kidFriendly,
            suitableFor: editingMeal.suitableFor,
            servings: editingMeal.servings,
            components: editingMeal.components,
          }}
          onSuccess={handleEditSuccess}
          onCancel={handleCancel}
        />
      </div>
    )
  }

  // Show list view
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">My recipes</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Create and manage your household&apos;s custom recipes</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <Body variant="muted">
                {isLoading
                  ? 'Loading...'
                  : `${meals.length} recipe${meals.length === 1 ? '' : 's'}`}
              </Body>
              <Button onClick={() => setViewMode('create')}>
                <Plus className="mr-2 h-4 w-4" />
                Add recipe
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <MealList
                meals={meals}
                onEdit={handleEdit}
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

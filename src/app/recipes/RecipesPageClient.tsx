'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Plus, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import {
  MealForm,
  type MealFormData,
  type PrefilledIngredient,
} from '@/components/household/MealForm'
import { MealList, type MealData } from '@/components/household/MealList'
import type { MealType } from '@/generated/prisma/enums'

type ViewMode = 'list' | 'create' | 'edit'

// Enhanced prefilled data from recipe import (includes match states)
interface EnhancedPrefilledData {
  name: string
  description: string | null
  preparationNotes?: string | null
  sourceUrl?: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  prefilledIngredients: PrefilledIngredient[]
  originalRecipeText?: string
}

export function RecipesPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const mode = searchParams.get('mode')
  const prefilled = searchParams.get('prefilled')

  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [meals, setMeals] = useState<MealData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingMeal, setEditingMeal] = useState<MealData | null>(null)
  const [prefilledData, setPrefilledData] = useState<EnhancedPrefilledData | null>(null)

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

  // Handle URL params for mode=create with prefilled data
  useEffect(() => {
    if (mode === 'create') {
      setViewMode('create')

      if (prefilled === 'true') {
        const stored = sessionStorage.getItem('prefilled-meal')
        if (stored) {
          try {
            const data = JSON.parse(stored) as EnhancedPrefilledData
            setPrefilledData(data)
          } catch {
            // Invalid data, ignore
          }
          // Clean up after reading
          sessionStorage.removeItem('prefilled-meal')
        }
      }

      // Clear URL params
      router.replace('/recipes', { scroll: false })
    }
  }, [mode, prefilled, router])

  useEffect(() => {
    fetchMeals()
  }, [fetchMeals])

  const handleCreateSuccess = () => {
    setViewMode('list')
    setPrefilledData(null)
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
    setPrefilledData(null)
  }

  // Build prefilled meal data for MealForm
  const getPrefilledMeal = (): MealFormData | undefined => {
    if (!prefilledData) return undefined

    return {
      name: prefilledData.name,
      description: prefilledData.description,
      preparationNotes: prefilledData.preparationNotes,
      sourceUrl: prefilledData.sourceUrl,
      timeMinutes: prefilledData.timeMinutes,
      kidFriendly: prefilledData.kidFriendly,
      suitableFor: prefilledData.mealTypes,
      servings: prefilledData.servings,
      prefilledIngredients: prefilledData.prefilledIngredients,
      originalRecipeText: prefilledData.originalRecipeText,
    }
  }

  // Show form view
  if (viewMode === 'create') {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <MealForm
          meal={getPrefilledMeal()}
          onSuccess={handleCreateSuccess}
          onCancel={handleCancel}
        />
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
            preparationNotes: editingMeal.preparationNotes,
            sourceUrl: editingMeal.sourceUrl,
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

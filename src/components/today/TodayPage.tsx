'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ChefHat } from 'lucide-react'
import { TodayMeals } from './TodayMeals'
import { TomorrowPreview } from './TomorrowPreview'
import { UrgentShopping } from './UrgentShopping'
import { CatchUpSection } from './CatchUpSection'
import { Card, CardContent } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import type {
  MealPlanWithContext,
  PantryIngredient,
  PantryItemFull,
  PlanEntry,
} from '@/components/meal-plan/types'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

interface ShoppingItem {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

interface CatchUpEntry extends PlanEntry {
  label: string
  planId: string
}

interface TodayPageProps {
  todayDate: string
  tomorrowDate: string
  plan: MealPlanWithContext | null
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  shoppingItems: ShoppingItem[]
  catchUpEntries: CatchUpEntry[]
  timezone: string
  isFirstGeneration?: boolean
  userName?: string
}

export function TodayPage({
  todayDate,
  tomorrowDate,
  plan,
  householdSize,
  pantryIngredients,
  pantryItems,
  shoppingItems,
  catchUpEntries,
  timezone,
  isFirstGeneration,
  userName,
}: TodayPageProps) {
  // Filter entries for today and tomorrow, sorted by meal type
  const { todayEntries, tomorrowEntries } = useMemo(() => {
    if (!plan) {
      return { todayEntries: [], tomorrowEntries: [] }
    }

    const mealTypeOrder = { breakfast: 0, lunch: 1, dinner: 2 }
    const byMealType = (a: PlanEntry, b: PlanEntry) =>
      (mealTypeOrder[a.mealType as keyof typeof mealTypeOrder] ?? 3) -
      (mealTypeOrder[b.mealType as keyof typeof mealTypeOrder] ?? 3)

    const today = plan.entries.filter((entry) => entry.date === todayDate).sort(byMealType)
    const tomorrow = plan.entries.filter((entry) => entry.date === tomorrowDate).sort(byMealType)

    return { todayEntries: today, tomorrowEntries: tomorrow }
  }, [plan, todayDate, tomorrowDate])

  if (isFirstGeneration) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-6 pt-8 pb-8">
            <div className="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
              <ChefHat className="text-primary h-8 w-8" />
            </div>
            <div className="flex flex-col gap-2">
              <Heading variant="h2">Welcome to Honkadori{userName ? `, ${userName}` : ''}!</Heading>
              <Body variant="muted">
                Let&apos;s plan your first week of meals. We&apos;ll suggest dinners based on your
                household size and preferences.
              </Body>
            </div>
            <Button asChild size="lg">
              <Link href="/meal-plan">Generate your first meal plan</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column: Meals */}
        <div className="flex flex-col gap-6">
          {catchUpEntries.length > 0 && (
            <CatchUpSection
              entries={catchUpEntries}
              pantryItems={pantryItems}
              householdSize={householdSize}
            />
          )}
          <TodayMeals
            entries={todayEntries}
            planId={plan?.id ?? null}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
            timezone={timezone}
          />
          <TomorrowPreview
            entries={tomorrowEntries}
            planId={plan?.id ?? null}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
          />
        </div>

        {/* Right column: Shopping */}
        <div className="flex flex-col gap-6">
          <UrgentShopping items={shoppingItems} />
        </div>
      </div>
    </div>
  )
}

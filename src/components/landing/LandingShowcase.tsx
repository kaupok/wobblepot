'use client'

import { useTranslations } from 'next-intl'
import { CardHeader } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'
import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import { MealImageCard, mealImageTitleWidth } from '@/components/meal-plan/MealImageCard'
import { MealTypeBadge } from '@/components/meal-plan/MealTypeBadge'
import { ProteinBadge } from '@/components/meal-plan/ProteinBadge'
import type { MealType, ProteinType } from '@/generated/prisma/enums'

/**
 * One day of a plan, drawn with the planner's own card so the landing page
 * shows the product rather than a picture of it: the slot badge, the meal's
 * tint and its illustration blended into the card (docs/DESIGN.md → Imagery).
 *
 * The three illustrations are copies of generated meal images, committed under
 * `public/landing/` so the page never depends on a household's data or a blob
 * store. Their hues are what `extractHue` returns for these files (re-extracted
 * for HON-1009's rule, after HON-1031's refit, and for HON-1014's split-edge
 * gate), so the cards tint exactly as they do in the app. Names and
 * descriptions come from the catalog, so an Estonian visitor reads an Estonian
 * day.
 */
export type ShowcaseMealKey = 'breakfast' | 'lunch' | 'dinner'

const SHOWCASE_MEALS: ReadonlyArray<{
  key: ShowcaseMealKey
  mealType: MealType
  proteinType: ProteinType
  imageUrl: string
  imageHue: number
}> = [
  {
    key: 'breakfast',
    mealType: 'breakfast',
    proteinType: 'eggs',
    imageUrl: '/landing/avocado-toast-poached-egg.jpg',
    imageHue: 103,
  },
  {
    key: 'lunch',
    mealType: 'lunch',
    proteinType: 'beef',
    imageUrl: '/landing/beef-bibimbap.jpg',
    imageHue: 108,
  },
  {
    key: 'dinner',
    mealType: 'dinner',
    proteinType: 'fish',
    imageUrl: '/landing/baked-salmon-asparagus.jpg',
    imageHue: 88,
  },
]

export function LandingShowcase() {
  const t = useTranslations('landing.showcase')

  return (
    <figure className="flex flex-col gap-3">
      {/* The day label at the timeline's Section size, as a paragraph: the
          landing page's outline is the hero's h1 and the section h2s, and an
          example day is not a section of it. */}
      <Heading variant="section" as="p">
        {t('day')}
      </Heading>
      <div className="flex flex-col gap-3">
        {SHOWCASE_MEALS.map((meal) => (
          <ShowcaseMealCard key={meal.key} meal={meal.key} />
        ))}
      </div>
      <figcaption className="sr-only">{t('caption')}</figcaption>
    </figure>
  )
}

interface ShowcaseMealCardProps {
  meal: ShowcaseMealKey
  /** The description under the name, from `md`. Off where the card is a small picture. */
  description?: boolean
}

/**
 * One meal of the example day on the planner's card. Exported so another
 * landing layout can place the same cards its own way.
 */
export function ShowcaseMealCard({ meal: key, description = true }: ShowcaseMealCardProps) {
  const t = useTranslations('landing.showcase')
  const meal = SHOWCASE_MEALS.find((m) => m.key === key)
  if (!meal) return null
  const name = t(`${meal.key}.name`)

  return (
    <MealImageCard
      meal={{
        name,
        imageUrl: meal.imageUrl,
        imageStatus: 'ready',
        imageHue: meal.imageHue,
      }}
      size="sm"
      // The planner card's head: badges, then the name capped before the
      // plate, then the description in the same column.
      head={
        <CardHeader className="px-4 pt-1 pb-1">
          <div className="flex min-h-8 items-center">
            <div className="flex flex-wrap items-center gap-1.5">
              <MealTypeBadge mealType={meal.mealType} />
              <KidFriendlyBadge compact />
              <ProteinBadge proteinType={meal.proteinType} />
            </div>
          </div>
          <div className={`flex min-w-0 flex-col ${mealImageTitleWidth()}`}>
            <div className="flex min-h-8 items-center">
              <Heading variant="section" as="p">
                {name}
              </Heading>
            </div>
            {description && (
              <div className="hidden md:line-clamp-2">
                <Body variant="muted">{t(`${meal.key}.description`)}</Body>
              </div>
            )}
          </div>
        </CardHeader>
      }
    />
  )
}

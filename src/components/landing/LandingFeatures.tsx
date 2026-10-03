'use client'

import type { ComponentType, ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Body, Heading } from '@/components/ui/typography'
import { MemberRow } from '@/components/household/MemberRow'
import { IngredientList } from '@/components/meal-plan/IngredientList'
import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import {
  MealImageCard,
  mealHueStyle,
  mealImageTitleWidth,
} from '@/components/meal-plan/MealImageCard'
import { MealTypeBadge } from '@/components/meal-plan/MealTypeBadge'
import { MyRecipeIcon } from '@/components/meal-plan/MyRecipeIcon'
import { PreparationSteps, type CookQuestionControls } from '@/components/meal-plan/PreparationTips'
import { ProteinBadge } from '@/components/meal-plan/ProteinBadge'
import { ServingControl } from '@/components/meal-plan/ServingControl'
import type { MealComponent, PantryIngredient } from '@/components/meal-plan/types'
import { formatWeight } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import { cn } from '@/lib/utils'
import type { Member, MemberPreferences } from '@/types/member'

/**
 * Every vignette shows the showcase dinner (`LandingShowcase`): its committed
 * illustration and the hue `extractHue` returns for it, so the section tells
 * one story, from the pantry to the stove.
 */
const MEAL_IMAGE_URL = '/landing/baked-salmon-asparagus.jpg'
const MEAL_HUE = 88

/**
 * Three members whose portions add up to the meal's 3 servings: 1.5 + 1 + 0.5.
 * The app scales a meal by its servings (`getEffectiveServings`), so with this
 * household the salmon reads the same here, in the pantry vignette and in the
 * real cook view: per serving × the portions' sum.
 */
const MEMBERS = [
  { key: 'adult1', role: 'owner', hasAccount: true, portionMultiplier: 1.5 },
  { key: 'adult2', role: 'member', hasAccount: true, portionMultiplier: 1 },
  { key: 'toddler', role: 'member', hasAccount: false, portionMultiplier: 0.5 },
] as const

const SERVINGS = MEMBERS.reduce((sum, member) => sum + member.portionMultiplier, 0)

/** Grams of salmon per serving; the cook view shows it × `SERVINGS`. */
const SALMON_GRAMS_PER_SERVING = 120

// Quantities per serving, in grams or (the lemon) pieces.
const INGREDIENTS = [
  {
    key: 'salmon',
    category: 'protein',
    unit: 'g',
    quantityPerServing: SALMON_GRAMS_PER_SERVING,
    inPantry: true,
  },
  { key: 'asparagus', category: 'vegetable', unit: 'g', quantityPerServing: 100, inPantry: true },
  { key: 'oliveOil', category: 'fat', unit: 'g', quantityPerServing: 10, inPantry: true },
  { key: 'lemon', category: 'fruit', unit: 'piece', quantityPerServing: 1 / 3, inPantry: false },
] as const

const POINTS = ['pantry', 'recipes', 'kids', 'cook'] as const
type Point = (typeof POINTS)[number]

const VIGNETTES: Record<Point, ComponentType> = {
  pantry: PantryVignette,
  recipes: RecipesVignette,
  kids: PortionsVignette,
  cook: CookVignette,
}

// The vignettes are pictures of the app, not controls: `inert` takes their
// checkboxes, field and buttons out of the tab order and the pointer's reach.
const noop = () => {}

/**
 * "Made for family kitchens" on the signed-out home page (HON-1038): the
 * heading and the trust line, then one row per point, each with a vignette
 * built from the app's own components in a fixed state, so the page proves
 * each claim with the product rather than a picture of it (docs/DESIGN.md →
 * Reject list). Nothing fetches and nothing saves.
 *
 * From `md` each row is two columns and the vignette swaps sides on every
 * other row; below `md` a row is the text, then its vignette. The DOM order is
 * always text first, so a screen reader reads the claim before its caption.
 */
export function LandingFeatures() {
  const t = useTranslations('landing.why')
  // The portions caption names the salmon the vignette shows.
  const salmon = useScaledSalmon()

  return (
    <section aria-labelledby="landing-why" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 text-balance">
        <Heading variant="h3" as="h2" id="landing-why">
          {t('title')}
        </Heading>
        <Body variant="muted">{t('lead')}</Body>
      </div>
      {/* WebKit drops list semantics from a `list-style: none` list, so the
          role restores them, as on "How it works". */}
      <ul role="list" className="flex list-none flex-col gap-12 md:gap-16">
        {POINTS.map((point, index) => {
          const Vignette = VIGNETTES[point]
          return (
            <li key={point} className="grid items-center gap-6 md:grid-cols-2 md:gap-12">
              <div className="flex flex-col gap-2">
                <Heading variant="section" as="h3">
                  {t(`${point}.title`)}
                </Heading>
                <Body variant="muted">{t(`${point}.body`)}</Body>
              </div>
              <figure
                data-testid={`landing-vignette-${point}`}
                className={cn('min-w-0', index % 2 === 1 && 'md:order-first')}
              >
                <div inert>
                  <Vignette />
                </div>
                {/* Outside the inert part, which assistive tech skips. */}
                <figcaption className="sr-only">
                  {t(`${point}.vignette.caption`, { quantity: salmon })}
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** A card on the meal's tint, as the cook view's panel is. */
function MealSurface({ children }: { children: ReactNode }) {
  return (
    <Card
      size="sm"
      data-meal-surface=""
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={mealHueStyle(MEAL_HUE)}
    >
      <CardContent className="py-4">{children}</CardContent>
    </Card>
  )
}

function useIngredients(): MealComponent[] {
  const t = useTranslations('landing.why.pantry.vignette')
  return INGREDIENTS.map(({ key, category, unit, quantityPerServing }) => ({
    ingredientId: key,
    quantityPerServing,
    ingredient: { id: key, name: t(key), category, defaultUnit: unit },
  }))
}

/** The cook view's ingredients: three ticked as in the pantry, the lemon to buy. */
function PantryVignette() {
  const components = useIngredients()
  const pantryIngredients: PantryIngredient[] = INGREDIENTS.filter((i) => i.inPantry).map((i) => ({
    ingredientId: i.key,
    isStaple: false,
  }))
  const missing = components.filter(
    (c) => !pantryIngredients.some((p) => p.ingredientId === c.ingredientId),
  )

  return (
    <MealSurface>
      <IngredientList
        components={components}
        servings={SERVINGS}
        pantryIngredients={pantryIngredients}
        onToggleAvailability={noop}
        availability={{
          isReady: missing.length === 0,
          missingCount: missing.length,
          missingIngredients: missing.map((c) => c.ingredient.name),
        }}
      />
    </MealSurface>
  )
}

/** A pasted link, and the same dish on the planner, marked as the household's own. */
function RecipesVignette() {
  const t = useTranslations('landing.why.recipes.vignette')
  const tMeal = useTranslations('landing.showcase.dinner')
  const name = tMeal('name')

  return (
    <div className="flex flex-col gap-3">
      <Input readOnly value={t('link')} aria-label={t('linkLabel')} />
      <MealImageCard
        meal={{ name, imageUrl: MEAL_IMAGE_URL, imageStatus: 'ready', imageHue: MEAL_HUE }}
        size="sm"
        // The planner card's head, as `LandingShowcase` draws it, with the
        // own-recipe mark after the name (`MealCard`).
        head={
          <CardHeader className="px-4 pt-1 pb-1">
            <div className="flex min-h-8 items-center">
              <div className="flex flex-wrap items-center gap-1.5">
                <MealTypeBadge mealType="dinner" />
                <KidFriendlyBadge compact />
                <ProteinBadge proteinType="fish" />
              </div>
            </div>
            <div className={cn('flex min-w-0 flex-col', mealImageTitleWidth())}>
              <div className="flex min-h-8 items-center">
                <Heading variant="section" as="p">
                  {name}
                  {'\u00a0'}
                  <MyRecipeIcon />
                </Heading>
              </div>
              <div className="hidden md:line-clamp-2">
                <Body variant="muted">{tMeal('description')}</Body>
              </div>
            </div>
          </CardHeader>
        }
      />
    </div>
  )
}

function member(
  key: string,
  name: string,
  role: Member['role'],
  hasAccount: boolean,
  portionMultiplier: number,
): Member {
  const preferences: MemberPreferences = {
    displayName: name,
    portionMultiplier,
    targetCalories: null,
    targetProtein: null,
    targetCarbs: null,
    targetFat: null,
    dietaryType: null,
    allergens: [],
    restrictions: [],
    excludedIngredients: [],
    excludedIngredientIds: [],
  }
  return {
    id: key,
    userId: hasAccount ? key : null,
    name,
    role,
    joinedAt: '2026-01-01T00:00:00.000Z',
    user: null,
    preferences,
    invite: null,
  }
}

/** The household page's member rows, then the meal's Serves and its salmon. */
function PortionsVignette() {
  const t = useTranslations('landing.why.kids.vignette')
  const [salmon] = useIngredients()

  return (
    <MealSurface>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y">
          {MEMBERS.map(({ key, role, hasAccount, portionMultiplier }) => (
            <MemberRow
              key={key}
              member={member(key, t(key), role, hasAccount, portionMultiplier)}
              canEdit={false}
              canRemove={false}
              canInvite={false}
              onEdit={noop}
              onRemove={noop}
              onRemoveFocus={noop}
              onInvite={noop}
              onInviteUpdated={noop}
            />
          ))}
        </ul>
        <div className="flex">
          <ServingControl
            servings={SERVINGS}
            householdSize={SERVINGS}
            onServingsChange={async () => false}
            disabled
          />
        </div>
        {salmon && <IngredientList components={[salmon]} servings={SERVINGS} />}
      </div>
    </MealSurface>
  )
}

/** The salmon for the meal's servings, as the cook view formats it. */
function useScaledSalmon(): string {
  const locale = useLocale() as Locale
  return formatWeight(SALMON_GRAMS_PER_SERVING * SERVINGS, locale)
}

const COOK_QUESTION: CookQuestionControls = {
  openSubject: null,
  onOpenSubject: noop,
  onClose: noop,
  ask: noop,
  active: null,
  previous: null,
  isPending: false,
  isStreaming: false,
  error: null,
  onRetry: noop,
}

/**
 * One step at the cook view's size with its Ask button, and an answer under
 * it. `CookQuestionPanel` is not used for the answer: it has no read-only
 * state (it always shows its chips, field, Send and Close) and scrolls itself
 * into view as it mounts, which would move the landing page on load. The
 * question and the answer take the panel's own type and indent instead.
 */
function CookVignette() {
  const t = useTranslations('landing.why.cook.vignette')
  const tSteps = useTranslations('meal-plan.tips')
  const tAsk = useTranslations('meal-plan.cookQuestion')

  return (
    <MealSurface>
      <div className="flex flex-col gap-3">
        <Heading variant="h4" as="p">
          {tSteps('steps')}
        </Heading>
        <PreparationSteps
          tips={{ steps: [t('step')], pitfalls: [] }}
          isLoading={false}
          error={null}
          onRetry={noop}
          onToggleStep={noop}
          cookQuestion={COOK_QUESTION}
        />
        <div className="flex flex-col gap-3 pl-15 lg:pl-16">
          <Body variant="step-small" tone="muted">
            {tAsk('youAsked', { question: t('question') })}
          </Body>
          <Body variant="step">{t('answer')}</Body>
        </div>
      </div>
    </MealSurface>
  )
}

'use client'

import { useState, type ComponentProps, type CSSProperties } from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MealImageStatus } from '@/generated/prisma/enums'

/** The image columns a meal payload carries (HON-735, HON-744). */
export interface MealImageFields {
  /** Illustration in Vercel Blob, set once `imageStatus` is `ready` */
  imageUrl?: string | null
  imageStatus?: MealImageStatus
  /** OKLCH hue in degrees taken from the image — the one per-meal colour */
  imageHue?: number | null
}

/**
 * The image covers at most the right 5/8 of a card (45% below `sm`). Cards run
 * from full width on a phone to a ~776px planner row, a ~448px grid column or
 * the 400px add-meal dialog.
 */
const SIZES = '(min-width: 768px) 480px, 45vw'

/**
 * Where the image sits in the card. Nothing the user reads or taps sits on its
 * opaque part (docs/DESIGN.md → Imagery → Cards).
 *
 * With trailing actions the image ends before the action column instead of
 * fading under it (HON-749). A right-end fade was the alternative, but a phone
 * card has room for the title, the actions and ~100px between them, not for an
 * image underneath the actions as well: fading it under the ~120px column would
 * leave almost nothing of the dish. `right-36` (144px) is the column — Note
 * ("Märkus" in Estonian), the `icon-sm` menu, their gap — plus the card's
 * `px-3`. The inset box can be narrower than 3:2, so `object-cover` may crop the
 * plate at its right edge; the short right fade keeps that from reading as a
 * hard edge.
 *
 * The narrow/wide switch is a container query on the card (`@md`, 448px), not
 * a viewport breakpoint: the alternatives grid puts ~250px cards on a desktop
 * screen, and those need the narrow geometry as much as a phone does.
 */
const IMAGE_BOX = {
  default: 'right-0 w-9/20 @md/meal-image:w-5/8',
  trailingActions: 'right-36 left-1/3 @md/meal-image:left-3/8 mask-r-from-80%',
} as const

/**
 * The widest the title may be on a tinted card: it wraps before it reaches the
 * image's opaque part. Fractions of the card's content row, matched to
 * `IMAGE_BOX` plus the 30% fade — change the two together.
 *
 * Keyed on the card's own `data-meal-surface` rather than the meal's fields: a
 * card whose image fails to load goes neutral, and its title gets the full row
 * back with it.
 */
const TITLE_WIDTH = {
  default:
    'group-data-meal-surface/meal-image:max-w-1/2 @md/meal-image:group-data-meal-surface/meal-image:max-w-3/8',
  trailingActions:
    'group-data-meal-surface/meal-image:max-w-1/3 @md/meal-image:group-data-meal-surface/meal-image:max-w-3/8',
} as const

/** The `max-width` classes for a title inside a `MealImageCard`, matching its image box. */
export function mealImageTitleWidth(trailingActions = false): string {
  return trailingActions ? TITLE_WIDTH.trailingActions : TITLE_WIDTH.default
}

/**
 * The hue to tint with, or null when the meal renders the neutral card: no
 * image, not `ready`, or no hue (docs/DESIGN.md → Imagery, "Absence renders
 * the neutral card").
 */
export function mealTintHue(meal: MealImageFields): number | null {
  if (meal.imageStatus !== 'ready' || !meal.imageUrl) return null
  return meal.imageHue ?? null
}

/** The value for the `style` prop of an element that carries `data-meal-surface`. */
export function mealHueStyle(hue: number): CSSProperties {
  return { '--meal-hue': hue } as CSSProperties
}

interface MealImageCardProps extends ComponentProps<typeof Card> {
  meal: MealImageFields & { name: string }
  /**
   * The card has an action column at the right end of its title row (the
   * planner card's Note and menu). The image then ends before it.
   */
  trailingActions?: boolean
}

/**
 * A `Card` that takes its meal's colour (HON-746, `docs/DESIGN.md` → Imagery):
 * tinted with the meal's `imageHue`, with the illustration blended into the
 * right of the card. A meal without an image, or without a hue, is a plain
 * `Card` — no tint, no image element, nothing reserved while it generates.
 *
 * The children are the card's content, unchanged: the tint re-scopes the theme
 * tokens (`[data-meal-surface]` in globals.css), so nothing inside needs a
 * tinted variant, and the image sits behind the content in the card's own
 * stacking context, so nothing inside moves.
 */
export function MealImageCard({
  meal,
  trailingActions = false,
  className,
  style,
  children,
  ...props
}: MealImageCardProps) {
  // Keyed by URL so a new image after an edit gets its own chance to load.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const hue = mealTintHue(meal)
  const imageUrl = meal.imageUrl

  // A URL that no longer resolves is an absent image: the card goes neutral
  // rather than keeping a tint with nothing to explain it. Errors are silent.
  const tinted = hue !== null && !!imageUrl && imageUrl !== brokenUrl

  // One tree for both states, with the image in a slot of its own ahead of
  // the content: the tint can switch on mid-session (an image generated from
  // the detail modal), and moving `children` to a different position would
  // remount the whole card — including the trigger the modal returns focus to.
  return (
    <Card
      data-meal-surface={tinted ? '' : undefined}
      className={cn(
        tinted && 'group/meal-image @container/meal-image relative isolate overflow-hidden',
        className,
      )}
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={tinted ? { ...style, ...mealHueStyle(hue) } : style}
      {...props}
    >
      {tinted ? (
        <CardImage
          key={imageUrl}
          src={imageUrl}
          alt={meal.name}
          trailingActions={trailingActions}
          onError={() => setBrokenUrl(imageUrl)}
        />
      ) : null}
      {children}
    </Card>
  )
}

interface CardImageProps {
  src: string
  alt: string
  trailingActions: boolean
  onError: () => void
}

function CardImage({ src, alt, trailingActions, onError }: CardImageProps) {
  const [loaded, setLoaded] = useState(false)

  return (
    // -z-10 inside the card's `isolate`: above the tint, below the content.
    // The blend and the fade sit on this wrapper, not the img: a positioned
    // element with a z-index is its own isolated group, so a blend on the img
    // would multiply against nothing and leave the white surface white.
    <div
      data-testid="meal-card-image"
      className={cn(
        'absolute inset-y-0 -z-10 mask-l-from-30% mix-blend-multiply',
        trailingActions ? IMAGE_BOX.trailingActions : IMAGE_BOX.default,
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={SIZES}
        onLoad={() => setLoaded(true)}
        onError={onError}
        className={cn(
          'object-cover transition-opacity duration-200 ease-out',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

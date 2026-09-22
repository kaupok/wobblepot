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
 * The image covers the right 5/8 of a card. Cards run from full width on a
 * phone to a ~448px grid column or the 400px add-meal dialog.
 */
const SIZES = '(min-width: 768px) 280px, 62vw'

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
export function MealImageCard({ meal, className, style, children, ...props }: MealImageCardProps) {
  // Keyed by URL so a new image after an edit gets its own chance to load.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const hue = mealTintHue(meal)
  const imageUrl = meal.imageUrl

  // A URL that no longer resolves is an absent image: the card goes neutral
  // rather than keeping a tint with nothing to explain it. Errors are silent.
  if (hue === null || !imageUrl || imageUrl === brokenUrl) {
    return (
      <Card className={className} style={style} {...props}>
        {children}
      </Card>
    )
  }

  return (
    <Card
      data-meal-surface=""
      className={cn('relative isolate overflow-hidden', className)}
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={{ ...style, ...mealHueStyle(hue) }}
      {...props}
    >
      <CardImage
        key={imageUrl}
        src={imageUrl}
        alt={meal.name}
        onError={() => setBrokenUrl(imageUrl)}
      />
      {children}
    </Card>
  )
}

function CardImage({ src, alt, onError }: { src: string; alt: string; onError: () => void }) {
  const [loaded, setLoaded] = useState(false)

  return (
    // -z-10 inside the card's `isolate`: above the tint, below the content.
    // The blend and the fade sit on this wrapper, not the img: a positioned
    // element with a z-index is its own isolated group, so a blend on the img
    // would multiply against nothing and leave the white surface white.
    <div
      data-testid="meal-card-image"
      className="absolute inset-y-0 right-0 -z-10 w-5/8 mask-l-from-30% mix-blend-multiply"
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

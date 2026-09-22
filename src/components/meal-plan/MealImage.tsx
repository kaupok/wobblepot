'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { mealHueStyle } from './MealImageCard'
import type { MealImageStatus } from '@/generated/prisma/enums'

/**
 * Rendered width of the dialog content: `MealDetailModal` is `md:max-w-2xl`
 * (672px) and `sm:max-w-md` (448px) with `p-6`, and `max-w-[calc(100%-2rem)]`
 * below `sm`.
 */
const SIZES = '(min-width: 768px) 624px, (min-width: 640px) 400px, calc(100vw - 5rem)'

interface MealImageProps {
  /** Used as the alt text, and nothing more (`docs/DESIGN.md` → Imagery) */
  mealName: string
  status: MealImageStatus
  imageUrl: string | null
  /** OKLCH hue taken from the image (HON-744); without one there is no hero */
  imageHue: number | null
}

/**
 * The meal's hero illustration (HON-737, HON-746), following `docs/DESIGN.md`
 * → Imagery: 3:2, full width, on the meal's tinted surface with the image
 * multiplied into it, the whole hero fading bottom-up into the dialog, and the
 * image fading in on load. A meal without an image, or without a hue, renders
 * nothing at all. The one exception is `generating`, where a plain box holds
 * the space so the content below does not jump when the image lands.
 */
export function MealImage({ mealName, status, imageUrl, imageHue }: MealImageProps) {
  if (status === 'ready' && imageUrl) {
    if (imageHue === null) return null
    // Keyed by URL so a different image starts transparent and fades in again.
    return <LoadedImage key={imageUrl} alt={mealName} src={imageUrl} hue={imageHue} />
  }

  if (status === 'generating') {
    return <div data-testid="meal-image-placeholder" className="bg-muted aspect-3/2 rounded-lg" />
  }

  return null
}

function LoadedImage({ alt, src, hue }: { alt: string; src: string; hue: number }) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)

  // A URL that no longer resolves (a blob deleted by a meal edit) is an
  // absent image, not a grey box: errors are silent.
  if (broken) return null

  // The fade is on the container, so the tint and the image leave together
  // and the hero ends in the dialog's own background rather than at an edge.
  // `isolate` keeps the multiply against the tint alone.
  return (
    <div
      data-meal-surface=""
      data-testid="meal-image-hero"
      className="relative isolate aspect-3/2 overflow-hidden rounded-t-lg mask-b-from-60%"
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={mealHueStyle(hue)}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={SIZES}
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
        className={cn(
          'object-cover mix-blend-multiply transition-opacity duration-200 ease-out',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { mealHueStyle } from './MealImageCard'
import type { MealImageStatus } from '@/generated/prisma/enums'

/**
 * Rendered width of the hero, which bleeds through the dialog's padding
 * (HON-752): `MealDetailModal` is `md:max-w-2xl` (672px) and `sm:max-w-md`
 * (448px), less its 1px borders, and `max-w-[calc(100%-2rem)]` below `sm`.
 *
 * At DPR 2 this picks the 1920w candidate, which Next caps at the 1536px
 * source (HON-748). The browser's `naturalWidth` is density-corrected; load
 * `currentSrc` into a `new Image()` to see the file's real width.
 */
const SIZES = '(min-width: 768px) 670px, (min-width: 640px) 446px, calc(100vw - 2rem)'

/**
 * Full-bleed 2:1 geometry shared by the hero and its `generating` box. The
 * negative margin cancels `DialogContent`'s `p-6`, so the hero runs edge to
 * edge across the dialog and reads as its header band rather than an inset
 * card (HON-752). It has no radius: the dialog clips it.
 */
const HERO_BOX = '-mx-6 aspect-2/1'

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
 * → Imagery: 2:1, full-bleed across the dialog, on the meal's tinted surface
 * with the image multiplied into it, the whole hero fading bottom-up into the
 * dialog (and briefly at the top), and the image fading in on load. A meal without an image, or without a hue, renders
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
    return <div data-testid="meal-image-placeholder" className={cn('bg-muted', HERO_BOX)} />
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
  // A short top fade does the same under the note, so the full-bleed band has
  // no hard edge anywhere (HON-752).
  // `isolate` keeps the multiply against the tint alone.
  return (
    <div
      data-meal-surface=""
      data-testid="meal-image-hero"
      className={cn('relative isolate overflow-hidden mask-t-from-85% mask-b-from-60%', HERO_BOX)}
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

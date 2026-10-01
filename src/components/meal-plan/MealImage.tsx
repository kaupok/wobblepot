'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { mealHueStyle, useImageLoaded } from './MealImageCard'
import type { MealImageStatus } from '@/generated/prisma/enums'

/**
 * Rendered width of the hero in the cook view (HON-932). Below `lg` the view is
 * the viewport and the hero spans it. From `lg` the view is a panel inset 24px
 * from the viewport, and the hero spans its left column, 2/5 of the panel:
 * 0.4 × (100vw − 48px), which `40vw` bounds from above.
 *
 * At DPR 2 a phone picks the ~828w candidate and a 1440px desktop the 1200w
 * one; Next caps everything at the 1536px source (HON-748). The browser's
 * `naturalWidth` is density-corrected; load `currentSrc` into a `new Image()`
 * to see the file's real width.
 */
const SIZES = '(min-width: 1024px) 40vw, 100vw'

/**
 * Full-bleed 3:2 geometry shared by the hero and its `generating` box: the
 * whole width of its column, edge to edge, with no radius (the panel clips
 * it). Capped at 45% of the viewport's height (`max-h-hero`), so a phone in
 * landscape still shows the title; past the cap the frame gets wider than
 * 3:2 and `object-cover` crops the plate's top and bottom.
 */
const HERO_BOX = 'aspect-3/2 max-h-hero w-full shrink-0'

interface MealImageProps {
  /** Used as the alt text, and nothing more (`docs/DESIGN.md` → Imagery) */
  mealName: string
  status: MealImageStatus
  imageUrl: string | null
  /** OKLCH hue taken from the image (HON-744); without one the hero is untinted */
  imageHue: number | null
  /**
   * The ready image's URL failed to load. The hero renders nothing either
   * way; the cook view uses this to drop the tint that came with it.
   */
  onError?: (imageUrl: string) => void
}

/**
 * The meal's hero illustration (HON-737, HON-746), following `docs/DESIGN.md`
 * → Imagery: 3:2, full-bleed across its column of the cook view, on the meal's
 * tinted surface with the image multiplied into it, the whole hero fading
 * bottom-up into the panel, and the image fading in on load. A meal
 * with an image but no hue keeps the image, on the untinted neutral surface
 * (HON-754). A meal without an image renders nothing at all. The one
 * exception is `generating`, where a plain box holds the space so the content
 * below does not jump when the image lands.
 */
export function MealImage({ mealName, status, imageUrl, imageHue, onError }: MealImageProps) {
  if (status === 'ready' && imageUrl) {
    // Keyed by URL so a different image starts transparent and fades in again.
    return (
      <LoadedImage
        key={imageUrl}
        alt={mealName}
        src={imageUrl}
        hue={imageHue}
        onError={() => onError?.(imageUrl)}
      />
    )
  }

  if (status === 'generating') {
    return <div data-testid="meal-image-placeholder" className={cn('bg-muted', HERO_BOX)} />
  }

  return null
}

interface LoadedImageProps {
  alt: string
  src: string
  hue: number | null
  onError: () => void
}

function LoadedImage({ alt, src, hue, onError }: LoadedImageProps) {
  const { loaded, ref, onLoad } = useImageLoaded()
  const [broken, setBroken] = useState(false)

  // A URL that no longer resolves (a blob deleted by a meal edit) is an
  // absent image, not a grey box: errors are silent.
  if (broken) return null

  // The fade is on the container, so the tint and the image leave together
  // and the hero ends in the panel's own tint rather than at an edge. It is
  // the first thing in its column, so it needs no top fade (HON-932).
  // `isolate` keeps the multiply against the tint alone. Without a hue the
  // surface is `neutral`: the tint's lightness at zero chroma (globals.css).
  return (
    <div
      data-meal-surface={hue === null ? 'neutral' : ''}
      data-testid="meal-image-hero"
      className={cn('relative isolate overflow-hidden mask-b-from-60%', HERO_BOX)}
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={hue === null ? undefined : mealHueStyle(hue)}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={SIZES}
        ref={ref}
        onLoad={onLoad}
        onError={() => {
          setBroken(true)
          onError()
        }}
        className={cn(
          'object-cover mix-blend-multiply transition-opacity duration-200 ease-out',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

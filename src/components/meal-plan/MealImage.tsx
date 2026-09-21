'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
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
}

/**
 * The meal's hero illustration (HON-737), following `docs/DESIGN.md` → Imagery:
 * 3:2, full width, `rounded-lg`, fading in on load. A meal without an image
 * renders nothing at all. The one exception is `generating`, where a plain box
 * holds the space so the content below does not jump when the image lands.
 */
export function MealImage({ mealName, status, imageUrl }: MealImageProps) {
  if (status === 'ready' && imageUrl) {
    // Keyed by URL so a different image starts transparent and fades in again.
    return <LoadedImage key={imageUrl} alt={mealName} src={imageUrl} />
  }

  if (status === 'generating') {
    return <div data-testid="meal-image-placeholder" className="bg-muted aspect-3/2 rounded-lg" />
  }

  return null
}

function LoadedImage({ alt, src }: { alt: string; src: string }) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)

  // A URL that no longer resolves (a blob deleted by a meal edit) is an
  // absent image, not a grey box: errors are silent.
  if (broken) return null

  return (
    <div className="bg-muted relative aspect-3/2 overflow-hidden rounded-lg">
      <Image
        src={src}
        alt={alt}
        fill
        sizes={SIZES}
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
        className={cn(
          'object-cover transition-opacity duration-200 ease-out',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

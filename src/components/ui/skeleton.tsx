import { cva, type VariantProps } from 'class-variance-authority'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

// A skeleton mirrors the shape of what it stands in for, so the shape is named
// after that thing rather than after a radius (HON-674). Size stays with the
// callsite (`h-*`, `w-*`, `size-*`); the corner belongs here, so a skeleton
// cannot drift from the element it mirrors one `rounded-*` at a time.
const skeletonVariants = cva('animate-pulse', {
  variants: {
    tone: {
      default: 'bg-accent',
      // Inside the shopping list's note sheet (HON-1016). The note re-maps
      // `--accent` to its chip, the colour of the sheet's dividers, so a
      // full-accent bar is as loud as a rule; half of it sits under them.
      soft: 'bg-accent/50',
    },
    shape: {
      // Text lines, buttons, inputs — every `rounded-md` control.
      default: 'rounded-md',
      // A list row or tile drawn as a bordered block.
      card: 'rounded-lg',
      // Avatars and round icon buttons.
      circle: 'rounded-full',
      // A `Checkbox`.
      checkbox: 'rounded-sm',
      // Full-bleed inside a parent that clips its own corners (an image band).
      flush: 'rounded-none',
    },
  },
  defaultVariants: {
    tone: 'default',
    shape: 'default',
  },
})

function Skeleton({
  className,
  shape,
  tone,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof skeletonVariants>) {
  // No 'use client': most callers are server `loading.tsx` files, where
  // next-intl resolves this from the request config rather than the provider.
  const t = useTranslations('common')
  return (
    <div
      data-slot="skeleton"
      data-shape={shape ?? 'default'}
      data-tone={tone ?? 'default'}
      role="status"
      aria-busy="true"
      aria-label={t('loading')}
      className={cn(skeletonVariants({ shape, tone }), className)}
      {...props}
    />
  )
}

export { Skeleton, skeletonVariants }

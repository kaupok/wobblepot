import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// A skeleton mirrors the shape of what it stands in for, so the shape is named
// after that thing rather than after a radius (HON-674). Size stays with the
// callsite (`h-*`, `w-*`, `size-*`); the corner belongs here, so a skeleton
// cannot drift from the element it mirrors one `rounded-*` at a time.
const skeletonVariants = cva('bg-accent animate-pulse', {
  variants: {
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
    shape: 'default',
  },
})

function Skeleton({
  className,
  shape,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape ?? 'default'}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn(skeletonVariants({ shape }), className)}
      {...props}
    />
  )
}

export { Skeleton, skeletonVariants }

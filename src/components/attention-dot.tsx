import { cn } from '@/lib/utils'

interface AttentionDotProps {
  /** Placement only, for example `absolute -top-0.5 -right-0.5` on an icon. */
  className?: string
}

/**
 * A small red dot that says something in a menu needs the household's
 * attention: on the account icon and on the "Past meals" row while past meals
 * are still to mark (HON-1028). Decoration only, so it is `aria-hidden`; the
 * control it sits on carries the meaning in its accessible name.
 *
 * The `ring-background` keeps the dot readable where it overlaps an icon's
 * stroke.
 */
export function AttentionDot({ className }: AttentionDotProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="attention-dot"
      className={cn('bg-destructive ring-background block size-2 rounded-full ring-2', className)}
    />
  )
}

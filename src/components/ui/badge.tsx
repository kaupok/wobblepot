import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  // The floor is the text badge's height — the `text-xs` line, `py-0.5` and
  // the border — so an icon-only badge, whose 14px icon sets no line box,
  // stands as tall as the text badges beside it.
  'inline-flex items-center justify-center rounded-full border min-h-[calc(var(--text-xs--line-height)+--spacing(1)+2px)] px-2.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3.5 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive:
          'border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline: 'text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        // Status outlines: the outline shape, tinted with the status token. The
        // badge's text still names the status, so colour is never the only cue.
        warning: 'border-warning/40 text-warning [a&]:hover:bg-warning-muted',
        info: 'border-info/40 text-info [a&]:hover:bg-info-muted',
        // Surface badges: the page background lifted onto the card, for a fact
        // that is not the meal's own (its prep time, the pantry's status). On a
        // tinted card that is a white pill on the colour, and the tint scope
        // drops the ring (`[data-variant^='surface']` in globals.css); on the
        // neutral card the ring from `--border` is what makes it a pill at all.
        // The border colour is deliberately not set here: a utility would beat
        // that scope's `border-color: transparent`.
        surface: 'bg-background text-foreground',
        'surface-success': 'bg-background text-success',
        'surface-warning': 'bg-background text-warning',
      },
      size: {
        default: '',
        // The cook view (HON-932), where nothing but the nutrition fine print
        // drops below 16px: the `text-sm` line instead of `text-xs`, with the
        // floor and the icon scaled to match.
        lg: 'min-h-[calc(var(--text-sm--line-height)+--spacing(2)+2px)] px-3 py-1 text-sm [&>svg]:size-4',
      },
      shape: {
        default: '',
        // A number on its own (HON-954): the floor is also the width, so one
        // digit makes a circle and two make a short pill of the same height.
        count: 'min-w-[calc(var(--text-xs--line-height)+--spacing(1)+2px)] px-1.5 tabular-nums',
      },
    },
    compoundVariants: [
      {
        size: 'lg',
        shape: 'count',
        className: 'min-w-[calc(var(--text-sm--line-height)+--spacing(2)+2px)]',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
      shape: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  size,
  shape,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant ?? 'default'}
      className={cn(badgeVariants({ variant, size, shape }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

'use client'

import * as React from 'react'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Registry `Toggle` (shadcn new-york), with two axes of ours on top:
//
// - `tone` is what the pressed state *means*. `default` keeps shadcn's neutral
//   `bg-accent`; `success` / `destructive` tint it with the status colour, the way
//   a thumbs-up / thumbs-down pair reads (HON-774). A toned toggle recedes to
//   `text-muted-foreground` at rest — the colour is the pressed cue, so it should
//   not be spent before the press. `data-[state=on]` sorts after `hover:` in
//   Tailwind 4, so a pressed toggle keeps its tint under the pointer.
// - `shape` is the outline: `circle` for round icon toggles.
//
// Sizes follow `Button`'s control heights (HON-612) rather than the registry's
// 36px default: `default` is the 44px touch target below `md`, `sm` is the 32px
// inline size (`Button`'s `sm` / `icon-sm`) for row-level actions.
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
      },
      tone: {
        default: 'data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
        success:
          'text-muted-foreground hover:text-foreground data-[state=on]:bg-success-muted data-[state=on]:text-success',
        destructive:
          'text-muted-foreground hover:text-foreground data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive',
      },
      shape: {
        default: '',
        circle: 'rounded-full',
      },
      size: {
        default: 'h-touch min-w-touch px-2 md:h-10 md:min-w-10',
        sm: 'h-8 min-w-8 px-1.5',
        lg: 'h-12 min-w-12 px-2.5 md:h-11 md:min-w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      tone: 'default',
      shape: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant,
  tone,
  shape,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, tone, shape, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }

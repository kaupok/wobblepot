'use client'

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { type VariantProps } from 'class-variance-authority'
import { Check } from 'lucide-react'
import * as React from 'react'

import { toggleVariants } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

// Registry `ToggleGroup` (shadcn new-york) on `Toggle`'s variants, so a part
// takes the same `tone`, `size` and `indicator` as a lone toggle. The group
// draws one outline and the parts sit flush inside it, a segmented control
// (the pantry row's stock state, HON-1624). `type="single"` makes the group a
// `radiogroup`, gives each part `role="radio"` with `aria-checked`, and moves
// between the parts with the arrow keys.

type ToggleGroupStyle = VariantProps<typeof toggleVariants> & {
  /** Show a check icon before the label of the pressed part. */
  indicator?: boolean
}

const ToggleGroupContext = React.createContext<ToggleGroupStyle>({})

function ToggleGroup({
  className,
  variant,
  tone,
  size,
  indicator = false,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & ToggleGroupStyle) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        'flex w-fit items-center rounded-md',
        // A ring, not a border, so the outline adds no height: the group is
        // as tall as one part.
        variant === 'outline' && 'ring-input ring-1',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, tone, size, indicator }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const { variant, tone, size, indicator } = React.useContext(ToggleGroupContext)
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        // The group owns the outline, so a part drops its own border and
        // rounds only the group's outer corners. The focused part rises so
        // its ring is not covered by the next part.
        toggleVariants({ tone, size }),
        variant === 'outline' && 'hover:bg-accent hover:text-accent-foreground',
        'rounded-none first:rounded-l-md last:rounded-r-md focus-visible:z-10',
        className,
      )}
      {...props}
    >
      {indicator && (
        <Check
          aria-hidden="true"
          data-slot="toggle-indicator"
          className="hidden group-data-[state=on]/toggle:block"
        />
      )}
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }

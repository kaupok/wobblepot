'use client'

import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * On is `success`, off is a muted track. The off track keeps a
 * `muted-foreground` border, the same 3:1 edge as the unticked `Checkbox`
 * (HON-1019). The 18px track (the shadcn size) reaches 44px through `::after` (14px past the 16px inside its border), the same way as
 * `Button` size `sm-touch`, so it fits a row without growing it.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer focus-visible:ring-ring/50 data-[state=checked]:border-success data-[state=checked]:bg-success data-[state=unchecked]:border-muted-foreground data-[state=unchecked]:bg-input relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border p-px transition-colors outline-none after:absolute after:inset-x-0 after:-inset-y-3.5 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="data-[state=checked]:bg-background data-[state=unchecked]:bg-muted-foreground pointer-events-none block size-3.5 rounded-full shadow-xs ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

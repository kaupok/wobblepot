'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '@/lib/utils'

// Radix `Tabs` for a view switch inside a page (HON-1578): `tablist` roles,
// arrow keys between tabs, and the inactive panel unmounted. The look is
// `RouteTabs`' underline row, so an in-page tab and a route tab read the same.
// A tab that changes the URL is a `RouteTabs` link, not this.

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex border-b', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // `-mb-px`: the current tab's underline covers the list's rule.
        'text-muted-foreground hover:text-primary data-[state=active]:border-primary data-[state=active]:text-foreground focus-visible:ring-ring/50 min-h-touch -mb-px flex items-center border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-3 md:min-h-10',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('focus-visible:ring-ring/50 outline-none focus-visible:ring-3', className)}
      {...props}
    />
  )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }

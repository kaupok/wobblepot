import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'

import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

// A short notice the user should read before acting, on its status tone's
// `-muted` surface (docs/DESIGN.md → Color). The text stays in the foreground
// tone: `muted-foreground` fails AA on a tint. `text-left` because a callsite
// may sit in a centred column (the landing page) and the text still reads as a
// paragraph.
const calloutVariants = cva('flex items-start gap-2 rounded-md border px-3 py-2 text-left', {
  variants: {
    tone: {
      info: 'border-info/30 bg-info-muted',
      warning: 'border-warning/30 bg-warning-muted',
      success: 'border-success/30 bg-success-muted',
    },
  },
  defaultVariants: {
    tone: 'info',
  },
})

// The icon is the non-colour cue for the tone. `mt-1` centres the 16px icon on
// the first 24px line of `paragraph`, so it stays there when the text wraps.
const iconVariants = cva('mt-1 size-4 shrink-0', {
  variants: {
    tone: {
      info: 'text-info',
      warning: 'text-warning',
      success: 'text-success',
    },
  },
  defaultVariants: {
    tone: 'info',
  },
})

type CalloutTone = NonNullable<VariantProps<typeof calloutVariants>['tone']>

const ICONS: Record<CalloutTone, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  success: CircleCheck,
}

function Callout({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof calloutVariants>) {
  const Icon = ICONS[tone ?? 'info']

  return (
    <div
      data-slot="callout"
      data-tone={tone ?? 'info'}
      className={cn(calloutVariants({ tone }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className={iconVariants({ tone })} />
      <Body variant="paragraph" className="min-w-0">
        {children}
      </Body>
    </div>
  )
}

export { Callout, calloutVariants, type CalloutTone }

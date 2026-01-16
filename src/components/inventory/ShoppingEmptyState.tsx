'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

export type ShoppingEmptyStateVariant = 'no-plan' | 'all-purchased' | 'nothing-needed' | 'error'

interface ShoppingEmptyStateProps {
  variant: ShoppingEmptyStateVariant
}

const CONTENT: Record<
  ShoppingEmptyStateVariant,
  {
    heading: string
    description: string
    buttonLabel?: string
    buttonHref?: string
  }
> = {
  'no-plan': {
    heading: 'No meal plan yet',
    description: 'Generate a meal plan to see your shopping list.',
    buttonLabel: 'Generate plan',
    buttonHref: '/dashboard',
  },
  'all-purchased': {
    heading: 'All done!',
    description: 'Your pantry is stocked for the week.',
  },
  'nothing-needed': {
    heading: 'Nothing to buy',
    description: 'Your pantry has everything you need for this week.',
  },
  error: {
    heading: 'Something went wrong',
    description: "We couldn't load your shopping list. Please try again.",
    buttonLabel: 'Go to dashboard',
    buttonHref: '/dashboard',
  },
}

export function ShoppingEmptyState({ variant }: ShoppingEmptyStateProps) {
  const content = CONTENT[variant]

  return (
    <Card className="w-full">
      <CardContent className="py-12">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <Heading variant="h2">{content.heading}</Heading>
            <Body variant="muted">{content.description}</Body>
          </div>
          {content.buttonLabel && content.buttonHref && (
            <Button asChild>
              <Link href={content.buttonHref}>{content.buttonLabel}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

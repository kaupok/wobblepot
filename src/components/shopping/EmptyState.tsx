'use client'

import Link from 'next/link'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

export type EmptyStateVariant = 'no-plan' | 'all-purchased' | 'nothing-needed' | 'error'

interface EmptyStateProps {
  variant: EmptyStateVariant
}

const CONTENT: Record<
  EmptyStateVariant,
  {
    heading: string
    description: string
    buttonLabel: string
    buttonHref: string
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
    buttonLabel: 'View pantry',
    buttonHref: '/pantry',
  },
  'nothing-needed': {
    heading: 'Nothing to buy',
    description: 'Your pantry has everything you need for this week.',
    buttonLabel: 'View pantry',
    buttonHref: '/pantry',
  },
  error: {
    heading: 'Something went wrong',
    description: "We couldn't load your shopping list. Please try again.",
    buttonLabel: 'Go to dashboard',
    buttonHref: '/dashboard',
  },
}

export function EmptyState({ variant }: EmptyStateProps) {
  const content = CONTENT[variant]

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <Heading variant="h2">{content.heading}</Heading>
        <Body variant="muted">{content.description}</Body>
      </div>
      <Button asChild>
        <Link href={content.buttonHref}>{content.buttonLabel}</Link>
      </Button>
    </div>
  )
}

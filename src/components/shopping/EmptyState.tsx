'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

export type EmptyStateVariant = 'no-plan' | 'all-purchased' | 'nothing-needed' | 'error'

interface EmptyStateProps {
  variant: EmptyStateVariant
}

const VARIANT_KEYS: Record<
  EmptyStateVariant,
  { heading: string; body: string; cta: string; href: string }
> = {
  'no-plan': {
    heading: 'noPlanHeading',
    body: 'noPlanBody',
    cta: 'noPlanCta',
    href: '/meal-plan',
  },
  'all-purchased': {
    heading: 'allDoneHeading',
    body: 'allDoneBody',
    cta: 'allDoneCta',
    href: '/pantry',
  },
  'nothing-needed': {
    heading: 'nothingHeading',
    body: 'nothingBodyShort',
    cta: 'nothingCta',
    href: '/pantry',
  },
  error: {
    heading: 'errorHeading',
    body: 'errorBody',
    cta: 'errorCta',
    href: '/meal-plan',
  },
}

export function EmptyState({ variant }: EmptyStateProps) {
  const t = useTranslations('shopping.emptyState')
  const keys = VARIANT_KEYS[variant]

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <div className="flex flex-col items-center gap-2">
        <Heading variant="h2">{t(keys.heading)}</Heading>
        <Body variant="muted">{t(keys.body)}</Body>
      </div>
      <Button asChild>
        <Link href={keys.href}>{t(keys.cta)}</Link>
      </Button>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { ShoppingListHeader } from './ShoppingListHeader'

export type ShoppingEmptyStateVariant = 'no-plan' | 'all-purchased' | 'nothing-needed' | 'error'

interface ShoppingEmptyStateProps {
  variant: ShoppingEmptyStateVariant
  windowDays?: number
}

const VARIANT_KEYS: Record<
  ShoppingEmptyStateVariant,
  { heading: string; body: string; bodyDays?: boolean; cta?: string; href?: string }
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
  },
  'nothing-needed': {
    heading: 'nothingHeading',
    body: 'nothingBody',
    bodyDays: true,
  },
  error: {
    heading: 'errorHeading',
    body: 'errorBody',
    cta: 'errorCta',
    href: '/meal-plan',
  },
}

/**
 * The two list-shaped variants get the shared header, so the window picker is
 * reachable from them: widening to 14 days is the natural next step both when
 * the pantry already covers the week and when everything has been bought.
 * `no-plan` and `error` are not list states — a wider window changes nothing
 * about either — so they stay header-less, as they have always been.
 */
const HEADER_VARIANTS: ReadonlySet<ShoppingEmptyStateVariant> = new Set([
  'nothing-needed',
  'all-purchased',
])

export function ShoppingEmptyState({ variant, windowDays = 7 }: ShoppingEmptyStateProps) {
  const t = useTranslations('shopping.emptyState')
  const keys = VARIANT_KEYS[variant]

  const description = keys.bodyDays ? t(keys.body, { days: windowDays }) : t(keys.body)
  const showHeader = HEADER_VARIANTS.has(variant)

  return (
    <Card className="w-full">
      {showHeader && <ShoppingListHeader windowDays={windowDays} />}
      <CardContent className={showHeader ? 'pt-0' : 'py-12'}>
        <div
          className={`flex flex-col items-center justify-center gap-4 text-center ${showHeader ? 'py-8' : ''}`}
        >
          <div className="flex flex-col items-center gap-2">
            <Heading variant="h4" as="h2">
              {t(keys.heading)}
            </Heading>
            <Body variant="muted">{description}</Body>
          </div>
          {keys.cta && keys.href && (
            <Button asChild>
              <Link href={keys.href}>{t(keys.cta)}</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

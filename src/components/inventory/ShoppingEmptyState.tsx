'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type ShoppingEmptyStateVariant = 'no-plan' | 'all-purchased' | 'nothing-needed' | 'error'

type WindowDays = 7 | 14

const WINDOW_STORAGE_KEY = 'shopping-list-window-days'

function getStoredWindowDays(): WindowDays {
  if (typeof window === 'undefined') return 7
  const stored = localStorage.getItem(WINDOW_STORAGE_KEY)
  return stored === '14' ? 14 : 7
}

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

export function ShoppingEmptyState({ variant, windowDays = 7 }: ShoppingEmptyStateProps) {
  const router = useRouter()
  const t = useTranslations('shopping.emptyState')
  const tShopping = useTranslations('shopping')
  const keys = VARIANT_KEYS[variant]
  const [mounted, setMounted] = useState(false)

  // Initialize after mount (SSR-safe) and check stored preference
  // Note: We need to track mounted state for hydration-safe Select rendering
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration pattern, same as ShoppingSection
    setMounted(true)

    if (variant === 'nothing-needed') {
      const storedDays = getStoredWindowDays()
      if (storedDays !== windowDays) {
        router.push(`/shopping?days=${storedDays}`)
      }
    }
  }, [variant, windowDays, router])

  const handleWindowChange = (value: string) => {
    const days = value === '14' ? 14 : 7
    localStorage.setItem(WINDOW_STORAGE_KEY, String(days))
    router.push(`/shopping?days=${days}`)
  }

  const description = keys.bodyDays ? t(keys.body, { days: windowDays }) : t(keys.body)
  const showWindowPicker = variant === 'nothing-needed'

  return (
    <Card className="w-full">
      {showWindowPicker && (
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Heading variant="h4" as="h2">
              {tShopping('title')}
            </Heading>
            {mounted && (
              <Select value={String(windowDays)} onValueChange={handleWindowChange}>
                <SelectTrigger size="sm" className="w-[100px]" aria-label={t('ariaTimeWindow')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">{t('windowOption7')}</SelectItem>
                  <SelectItem value="14">{t('windowOption14')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent className={showWindowPicker ? 'pt-0' : 'py-12'}>
        <div
          className={`flex flex-col items-center justify-center gap-4 text-center ${showWindowPicker ? 'py-8' : ''}`}
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

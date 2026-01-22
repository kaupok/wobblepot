'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

const CONTENT: Record<
  ShoppingEmptyStateVariant,
  {
    heading: string
    description: string | ((windowDays: number) => string)
    buttonLabel?: string
    buttonHref?: string
  }
> = {
  'no-plan': {
    heading: 'No meal plan yet',
    description: 'Generate a meal plan to see your shopping list.',
    buttonLabel: 'Generate plan',
    buttonHref: '/meal-plan',
  },
  'all-purchased': {
    heading: 'All done!',
    description: 'Your pantry is stocked for the week.',
  },
  'nothing-needed': {
    heading: 'Nothing to buy',
    description: (windowDays: number) =>
      `Your pantry has everything you need for the next ${windowDays} days.`,
  },
  error: {
    heading: 'Something went wrong',
    description: "We couldn't load your shopping list. Please try again.",
    buttonLabel: 'Go to dashboard',
    buttonHref: '/meal-plan',
  },
}

export function ShoppingEmptyState({ variant, windowDays = 7 }: ShoppingEmptyStateProps) {
  const router = useRouter()
  const content = CONTENT[variant]
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

  const description =
    typeof content.description === 'function'
      ? content.description(windowDays)
      : content.description

  const showWindowPicker = variant === 'nothing-needed'

  return (
    <Card className="w-full">
      {showWindowPicker && (
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Heading variant="h2">Shopping list</Heading>
            {mounted && (
              <Select value={String(windowDays)} onValueChange={handleWindowChange}>
                <SelectTrigger size="sm" className="w-[100px]" aria-label="Time window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
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
            <Heading variant="h2">{content.heading}</Heading>
            <Body variant="muted">{description}</Body>
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

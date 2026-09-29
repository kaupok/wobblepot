'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The back arrow beside the `h1` on every page behind `/recipes`: create, edit,
 * imagine and import (HON-822). A plain link — it leaves without the
 * confirmation the forms' Cancel can ask for. Ghost `sm` with an icon child is
 * 36×32px; `-ml-2` pulls the ghost padding back so the arrow lines up with the
 * column edge.
 */
export function BackToRecipesLink() {
  const t = useTranslations('recipes.edit')

  return (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <Link href="/recipes" aria-label={t('backToRecipes')}>
        <ArrowLeft />
      </Link>
    </Button>
  )
}

/**
 * The arrow's place in a skeleton title row: same box and offset as
 * `BackToRecipesLink`, so the title beside it does not shift on load.
 */
export function BackToRecipesLinkSkeleton() {
  return <Skeleton className="-ml-2 h-8 w-9" />
}

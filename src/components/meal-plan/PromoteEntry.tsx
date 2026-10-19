'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { PromoteEntryDialog } from './PromoteEntryDialog'
import { usePromoteEntry } from './use-promote-entry'
import type { EntryChange } from './types'

interface PromoteEntryProps {
  planId: string
  entryId: string
  changes: readonly EntryChange[]
  /** The meal is the household's own recipe: "Update the recipe". */
  isCustom: boolean
  mealName: string
  /** The recipe was saved and the server dropped the entry's cached steps. */
  onChanged: () => void
}

/**
 * "Make it my recipe" (HON-1245) under a planned entry's ingredients: keeps
 * its changes for good. On a library meal it makes a household recipe; on the
 * household's own recipe it is "Update the recipe". Shown only while a change
 * applies: a stale one does nothing, so there is nothing to keep.
 */
export function PromoteEntry({
  planId,
  entryId,
  changes,
  isCustom,
  mealName,
  onChanged,
}: PromoteEntryProps) {
  const t = useTranslations('meal-plan.changes.promote')
  const [open, setOpen] = useState(false)
  const { promote, isPending } = usePromoteEntry({ planId, entryId, onChanged })

  if (!changes.some((change) => !change.stale)) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full md:w-auto md:self-start"
        onClick={() => setOpen(true)}
      >
        {isCustom ? t('updateAction') : t('forkAction')}
      </Button>
      <PromoteEntryDialog
        open={open}
        onOpenChange={setOpen}
        isCustom={isCustom}
        mealName={mealName}
        isSubmitting={isPending}
        onSubmit={promote}
      />
    </>
  )
}

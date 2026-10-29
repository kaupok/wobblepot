'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

import { PromoteEntryDialog } from './PromoteEntryDialog'
import type { EntryChange } from './types'
import { usePromoteEntry } from './use-promote-entry'

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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const saved = useRef(false)

  if (!changes.some((change) => !change.stale)) return null

  return (
    <>
      <Button
        ref={buttonRef}
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
        onSubmit={async (name) => {
          saved.current = await promote(name)
          return saved.current
        }}
        // A save clears the entry's changes, so the refresh unmounts this
        // button, and focus returned to it would fall to <body>
        // (docs/DESIGN.md → Focus management). The cook view's scroll region
        // stays, so focus goes there.
        onCloseAutoFocus={(event) => {
          if (!saved.current) return
          saved.current = false
          const region = buttonRef.current?.closest<HTMLElement>('[data-slot="cook-view-scroll"]')
          if (!region) return
          event.preventDefault()
          region.focus({ preventScroll: true })
        }}
      />
    </>
  )
}

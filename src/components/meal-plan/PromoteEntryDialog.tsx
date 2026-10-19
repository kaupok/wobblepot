'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { cn } from '@/lib/utils'

/** The household meal create bound, as the route checks it. */
const MAX_NAME_LENGTH = 200

interface PromoteEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The meal is the household's own recipe: the dialog updates it. Otherwise
   * it makes a new recipe from a library meal, under a name the household can
   * change.
   */
  isCustom: boolean
  /** The meal's name, which the new recipe's name starts from. */
  mealName: string
  isSubmitting: boolean
  /** Resolves true once saved; the dialog then closes. `name` is unused on an update. */
  onSubmit: (name: string) => Promise<boolean>
  /** Where focus goes on close, when the control that opened it may be gone. */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * Confirms "Make it my recipe" (HON-1245) and says what it does before the
 * write: a new recipe in My recipes that this meal then uses, or the
 * household's own recipe updated, with every planned meal of it.
 */
export function PromoteEntryDialog({
  open,
  onOpenChange,
  isCustom,
  mealName,
  isSubmitting,
  onSubmit,
  onCloseAutoFocus,
}: PromoteEntryDialogProps) {
  const t = useTranslations('meal-plan.changes.promote')
  const tCommon = useTranslations('common')
  const nameId = useId()
  const formId = `${nameId}-form`
  const defaultName = t('myVersionName', { name: mealName }).slice(0, MAX_NAME_LENGTH)
  const [name, setName] = useState(defaultName)
  // The submit button is disabled while the recipe is saved; after a refusal
  // the dialog stays open, so focus goes back to it (docs/DESIGN.md → Focus).
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isSubmitting)

  // A reopened dialog starts from the default name.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setName(defaultName)
  }

  const valid = isCustom || name.trim().length > 0

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid || isSubmitting) return
    if (await onSubmit(name.trim())) onOpenChange(false)
    else requestRefocus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{isCustom ? t('updateTitle') : t('forkTitle')}</DialogTitle>
          <DialogDescription>
            {isCustom ? t('updateDescription') : t('forkDescription')}
          </DialogDescription>
        </DialogHeader>

        {/* An update asks for nothing, so its form takes no room; the
            footer's submit button still submits it. */}
        <form
          id={formId}
          onSubmit={submit}
          className={cn('flex flex-col gap-2', isCustom && 'hidden')}
        >
          {!isCustom && (
            <>
              <Label htmlFor={nameId}>{t('nameLabel')}</Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_NAME_LENGTH}
                required
                disabled={isSubmitting}
              />
            </>
          )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {tCommon('cancel')}
          </Button>
          <Button ref={submitRef} type="submit" form={formId} disabled={!valid || isSubmitting}>
            {isCustom ? t('submitUpdate') : t('submitFork')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

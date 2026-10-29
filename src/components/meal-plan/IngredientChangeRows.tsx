'use client'

import { MoreHorizontal, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Li } from '@/components/ui/typography'

import type { IngredientChangeControls } from './IngredientList'
import type { EntryChange, MealComponent } from './types'

/**
 * The parts of `IngredientList` that show and edit a planned entry's own
 * ingredient changes (HON-1243): the trailing control of each row, the rows
 * a change brings back (left out, stale), and the button that adds one.
 */

function UndoButton({
  change,
  name,
  controls,
}: {
  change: EntryChange
  name: string
  controls: IngredientChangeControls
}) {
  const t = useTranslations('meal-plan.changes')
  return (
    // 44px or more, as every button in the cook view (docs/DESIGN.md → "The
    // cook view is built for the counter").
    <Button
      variant="ghost"
      size="lg"
      onClick={() => controls.onUndo(change)}
      // `aria-disabled`, not `disabled`: a disabled button drops focus to the
      // body while the request runs (docs/DESIGN.md → Focus management).
      aria-disabled={controls.disabled || controls.undoingId === change.id}
      aria-label={t('undoAria', { name })}
    >
      {t('undo')}
    </Button>
  )
}

/**
 * The control at the end of an ingredient row: the menu with Replace and Leave
 * out for an unchanged row, or Undo for a changed one. The change itself reads
 * as a muted line under the name, in `IngredientList` (HON-1370). Without
 * `controls` (a cooked or skipped entry) the row has no control.
 */
export function EntryChangeRowActions({
  component,
  change,
  controls,
}: {
  component: MealComponent
  change: EntryChange | undefined
  controls: IngredientChangeControls | undefined
}) {
  const t = useTranslations('meal-plan.changes')
  const name = component.ingredient.name

  if (!controls) return null

  if (change) return <UndoButton change={change} name={name} controls={controls} />

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="shrink-0"
          aria-label={t('rowMenu', { name })}
          aria-disabled={controls.disabled}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          size="lg"
          disabled={controls.disabled}
          onSelect={() => controls.onReplace(component)}
        >
          {t('replace')}
        </DropdownMenuItem>
        <DropdownMenuItem
          size="lg"
          disabled={controls.disabled}
          onSelect={() => controls.onLeaveOut(component)}
        >
          {t('leaveOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Keeps a row without a checkbox in line with the rows that have one: the
 * width of the `lg` checkbox, so the quantity and name columns line up.
 */
function CheckboxColumn({ show }: { show: boolean }) {
  return show ? <span aria-hidden="true" className="size-6 shrink-0" /> : null
}

/** A left-out ingredient: still listed, struck through, so the cook sees what is missing. */
export function LeftOutRow({
  change,
  controls,
  checkboxColumn,
}: {
  change: EntryChange
  controls: IngredientChangeControls | undefined
  /** The other rows have checkboxes, so this one keeps their column. */
  checkboxColumn: boolean
}) {
  const t = useTranslations('meal-plan.changes')
  const name = change.original?.name ?? ''
  return (
    <Li className="flex items-center gap-2">
      <div className="min-h-touch flex min-w-0 flex-1 items-center gap-3 py-1 text-base">
        <CheckboxColumn show={checkboxColumn} />
        <span className="text-muted-foreground w-24 shrink-0">{t('leftOut')}</span>
        <span className="text-muted-foreground min-w-0 wrap-break-word line-through">{name}</span>
      </div>
      {controls && <UndoButton change={change} name={name} controls={controls} />}
    </Li>
  )
}

/**
 * A change the recipe was edited out from under, so it does nothing: the
 * recipe dropped its original, or gained the ingredient it brings in. Only
 * Undo is offered.
 */
export function StaleChangeRow({
  change,
  controls,
  checkboxColumn,
}: {
  change: EntryChange
  controls: IngredientChangeControls | undefined
  checkboxColumn: boolean
}) {
  const t = useTranslations('meal-plan.changes')
  const name = change.replacement?.name ?? change.original?.name ?? ''
  return (
    <Li className="flex items-center gap-2">
      <div className="min-h-touch flex min-w-0 flex-1 items-center gap-3 py-1 text-base">
        <CheckboxColumn show={checkboxColumn} />
        <span className="w-24 shrink-0" aria-hidden="true" />
        <span className="text-muted-foreground flex min-w-0 flex-col wrap-break-word">
          <span>{name}</span>
          <span>{t('stale')}</span>
        </span>
      </div>
      {controls && <UndoButton change={change} name={name} controls={controls} />}
    </Li>
  )
}

/**
 * The action at the right end of an editable list's Ingredients heading line
 * (HON-1357): add an ingredient to this entry only. The visible "Add" sits
 * inside the accessible name, so speech input finds it (WCAG 2.5.3).
 */
export function AddIngredientButton({
  controls,
  buttonRef,
  className,
}: {
  controls: IngredientChangeControls
  buttonRef?: React.Ref<HTMLButtonElement>
  className?: string
}) {
  const t = useTranslations('meal-plan.changes')
  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="lg"
      className={className}
      onClick={controls.onAdd}
      aria-disabled={controls.disabled}
      aria-label={t('addIngredient')}
    >
      <Plus aria-hidden="true" />
      {t('add')}
    </Button>
  )
}

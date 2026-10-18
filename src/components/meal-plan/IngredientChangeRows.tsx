'use client'

import { MoreHorizontal, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
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
 * ingredient changes (HON-1243): the trailing control of each row, and the
 * rows a change brings back (left out, stale) or offers (add one).
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
 * out for an unchanged row, or the change's label and Undo for a changed one.
 * Without `controls` (a cooked or skipped entry) only the label shows.
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

  if (change) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        {!change.original && (
          <Badge variant="info" size="lg">
            {t('added')}
          </Badge>
        )}
        {controls && <UndoButton change={change} name={name} controls={controls} />}
      </div>
    )
  }

  if (!controls) return null

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
          disabled={controls.disabled}
          onSelect={() => controls.onReplace(component)}
        >
          {t('replace')}
        </DropdownMenuItem>
        <DropdownMenuItem
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
        <span className="text-muted-foreground line-through">{name}</span>
      </div>
      {controls && <UndoButton change={change} name={name} controls={controls} />}
    </Li>
  )
}

/**
 * A change whose original the recipe no longer has, so it does nothing: the
 * recipe was edited after the change. Only Undo is offered.
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
        <span className="text-muted-foreground flex flex-col">
          <span>{name}</span>
          <span>{t('stale')}</span>
        </span>
      </div>
      {controls && <UndoButton change={change} name={name} controls={controls} />}
    </Li>
  )
}

/** The last row of an editable list: add an ingredient to this entry only. */
export function AddIngredientRow({
  controls,
  buttonRef,
}: {
  controls: IngredientChangeControls
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  const t = useTranslations('meal-plan.changes')
  return (
    <Li>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="lg"
        onClick={controls.onAdd}
        aria-disabled={controls.disabled}
      >
        <Plus aria-hidden="true" />
        {t('addIngredient')}
      </Button>
    </Li>
  )
}

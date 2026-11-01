'use client'

import { useTranslations } from 'next-intl'

import { Switch } from '@/components/ui/switch'
import { Body } from '@/components/ui/typography'

interface PantrySwitchProps {
  /** The pantry row the switch acts on. */
  pantryItemId: string
  /** The name the switch's label reads. */
  name: string
  /** Off when the row is at 0, ran out. */
  checked: boolean
  /** The switch going on, "Have it". */
  onHaveIt: () => void
  /** The switch going off, "Ran out". */
  onRanOut: () => void
}

/**
 * The pantry's "Have it / Ran out" switch with its state word (HON-1535). The
 * pantry row and Today's "At home" tab (HON-1578) both render it, so the two
 * read the same.
 */
export function PantrySwitch({
  pantryItemId,
  name,
  checked,
  onHaveIt,
  onRanOut,
}: PantrySwitchProps) {
  const tPantry = useTranslations('pantry')
  return (
    <>
      {/* The word names the state, not the action, so the row never reads as
          ran out while it is on hand (HON-1535). A minimum width, so a flip
          does not move the switch, and a longer word pushes the switch left
          instead of covering it; `aria-checked` carries the state to a screen
          reader. */}
      <div aria-hidden data-state-word className="min-w-12.75 text-right">
        <Body variant="caption">{tPantry(checked ? 'haveIt' : 'ranOut')}</Body>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(next) => (next ? onHaveIt() : onRanOut())}
        data-on-hand={pantryItemId}
        aria-label={tPantry('ariaHaveIt', { name })}
      />
    </>
  )
}

'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpen, Sparkles, Wand, type LucideIcon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** The selector view a route opens: the library list, or imagine. */
export type AddMealView = 'library' | 'imagine'

/** A route: a selector view, or `pick`, which places the top suggestion with no dialog (HON-1248). */
export type AddMealChoice = AddMealView | 'pick'

// In menu order. Both callers offer the same routes, so the list lives here
// and a new route is one entry.
const ITEMS: {
  choice: AddMealChoice
  label: 'chooseRecipe' | 'pickForMe' | 'imagineMeal'
  Icon: LucideIcon
}[] = [
  { choice: 'library', label: 'chooseRecipe', Icon: BookOpen },
  { choice: 'pick', label: 'pickForMe', Icon: Wand },
  { choice: 'imagine', label: 'imagineMeal', Icon: Sparkles },
]

interface AddMealMenuProps {
  /** The trigger: one element that takes a ref, as Radix `asChild` needs. */
  children: ReactNode
  /** Called with the chosen route. A view opens the selector in it; `pick` fills the slot. */
  onChoose: (choice: AddMealChoice) => void
  /**
   * Keeps the menu closed. Mark the trigger `aria-disabled`, not `disabled`:
   * a disabled button drops focus and cannot take it back when the selector
   * closes (HON-803).
   */
  disabled?: boolean
}

/**
 * The routes to a meal for an open slot, from the empty slot's button and the
 * cleared card's "Add meal" (HON-1247). The route is chosen here, so the
 * selector opens in the view built for it.
 */
export function AddMealMenu({ children, onChoose, disabled = false }: AddMealMenuProps) {
  const tCard = useTranslations('meal-plan.card')
  const [open, setOpen] = useState(false)

  return (
    // Not modal, as the card's ⋯ menu: an item opens a modal dialog, and a
    // modal menu closing under it can leave the body without pointer events.
    <DropdownMenu
      modal={false}
      open={open && !disabled}
      onOpenChange={(next) => setOpen(next && !disabled)}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {/* Both triggers end at the meal column's right edge, so the menu does
          too rather than hang past it. */}
      <DropdownMenuContent align="end">
        {ITEMS.map(({ choice, label, Icon }) => (
          <DropdownMenuItem key={choice} onSelect={() => onChoose(choice)}>
            <Icon aria-hidden="true" />
            {tCard(label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

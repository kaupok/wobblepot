'use client'

import { MoreHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type Ref, type RefObject, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

// Each ready-made question's catalog key, by what the panel is about (HON-983).
const READY_QUESTION_KEYS = {
  step: ['chips.done', 'chips.substitute', 'chips.time'],
  equipment: ['equipmentChips.instead', 'equipmentChips.size', 'equipmentChips.skip'],
} as const

/** Where focus goes once the menu has closed on a pick */
export type CookQuestionFocusTarget = 'close' | 'field'

export interface CookQuestionMenuProps {
  ref: Ref<HTMLButtonElement>
  /** "Ask about step {n}" or "Ask about {item}": the accessible name and the tooltip */
  label: string
  kind: CookQuestionSubject['kind']
  /** Whether this row's panel is open */
  open: boolean
  /**
   * True while this row's answer is pending or streaming. Every item is
   * disabled then: the route keeps generating an answer the browser aborts,
   * so a second pick bills a second call (HON-1360). "Ask your own question"
   * aborts it too, because opening the panel resets it (HON-1442).
   */
  busy: boolean
  panelId: string
  /** True while a panel closed by a tap or a click hands focus back to this button */
  quietFocus: RefObject<boolean>
  /** Open the row's panel and send a ready-made question */
  onAsk: (question: string) => void
  /** Open the row's panel with only the field */
  onAskOwn: () => void
  /** Focus the open panel's × Close or its field */
  onFocusPanel: (target: CookQuestionFocusTarget) => void
}

/**
 * The ⋯ menu at the end of a step row or a row of "You'll need" (HON-1350):
 * the three ready-made questions, then "Ask your own question". The tooltip
 * names the step or the item on hover and on keyboard focus, and the
 * `aria-label` is the same text, so the rows' buttons tell apart. With the
 * row's panel open the button is expanded but stays ghost: the panel's card
 * under the row is the visible sign, and a filled button beside it was the
 * heaviest thing on the row (HON-1371). Close is in the panel.
 */
export function CookQuestionMenu({
  ref,
  label,
  kind,
  open,
  busy,
  panelId,
  quietFocus,
  onAsk,
  onAskOwn,
  onFocusPanel,
}: CookQuestionMenuProps) {
  const t = useTranslations('meal-plan.cookQuestion')
  const [menuOpen, setMenuOpen] = useState(false)
  // Set by a pick, read once as the menu closes.
  const picked = useRef<CookQuestionFocusTarget | null>(null)

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger
          asChild
          // Radix opens on any focus, so also on the focus a closed panel hands
          // back. After a tap the tooltip would cover the step until the next
          // tap, because a touch never leaves the button. Radix skips its own
          // focus handler when ours prevents the default.
          onFocus={(e) => {
            if (quietFocus.current) e.preventDefault()
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              ref={ref}
              variant="ghost"
              size="icon-lg"
              aria-label={label}
              // The menu sets its own state while it is open; the panel's
              // otherwise. Left out, not undefined, so the menu's
              // `aria-controls` stands while it is open.
              aria-expanded={menuOpen || open}
              {...(open && !menuOpen && { 'aria-controls': panelId })}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent size="lg">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        // Radix returns focus to the trigger as the menu closes, and on a
        // pointer pick it has already pulled focus back into the closing menu
        // (HON-946). After a pick, focus the panel here instead: Close for a
        // ready-made question, never the field, which opens a phone's
        // keyboard; the field for the cook's own question.
        onCloseAutoFocus={(event) => {
          const target = picked.current
          if (!target) return
          event.preventDefault()
          picked.current = null
          onFocusPanel(target)
        }}
      >
        {READY_QUESTION_KEYS[kind].map((key) => (
          <DropdownMenuItem
            key={key}
            size="lg"
            disabled={busy}
            onSelect={() => {
              picked.current = 'close'
              onAsk(t(key))
            }}
          >
            {t(key)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          size="lg"
          disabled={busy}
          onSelect={() => {
            picked.current = 'field'
            onAskOwn()
          }}
        >
          {t('askOwn')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

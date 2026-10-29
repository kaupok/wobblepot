'use client'

import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Body, Heading } from '@/components/ui/typography'

/**
 * The household's own notes on the meal, under "Your notes", closed until the
 * cook opens them (HON-1259). The generated steps follow the notes and the
 * current ingredient list, so they are the method; the notes stay the
 * household's text, word for word, with their line breaks. The open state is
 * not stored: every visit starts closed.
 *
 * The trigger is a button inside the heading, the disclosure pattern, so the
 * section is still a heading to jump to. It takes the heading's type, as
 * "Watch out" and "Tip" do, and the chevron turns as it opens. Radix sets
 * `aria-expanded` and `aria-controls`. The focus outline is the tint's text
 * colour, as on the step toggles.
 */
export function PreparationNotes({ notes }: { notes: string }) {
  const t = useTranslations('meal-plan.steps')
  return (
    <Collapsible>
      {/* The row bleeds left by its padding, so the chevron lines up with the
          headings above, as the step rows do. */}
      <div className="-ml-3">
        <Heading variant="h4" as="h3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group focus-visible:outline-foreground flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              />
              {t('userNotes')}
            </button>
          </CollapsibleTrigger>
        </Heading>
      </div>
      <CollapsibleContent>
        <div className="pt-2">
          <Body variant="step" className="whitespace-pre-line">
            {notes}
          </Body>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

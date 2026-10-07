'use client'

import { useId } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Label } from '@/components/ui/label'
import { Toggle } from '@/components/ui/toggle'
import { Body } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { Allergen } from '@/generated/prisma/enums'

export const ALLERGEN_VALUES: readonly Allergen[] = [
  'gluten',
  'dairy',
  'eggs',
  'nuts',
  'peanuts',
  'soy',
  'fish',
  'shellfish',
  'sesame',
]

function AllergenToggle({
  value,
  pressed,
  disabled,
  onPressedChange,
}: {
  value: Allergen
  pressed: boolean
  disabled: boolean
  onPressedChange: (pressed: boolean) => void
}) {
  const label = useEnumLabel('Allergen', value)
  return (
    <Toggle
      variant="outline"
      tone="primary"
      size="chip"
      indicator
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
    >
      {label}
    </Toggle>
  )
}

interface AllergenPickerProps {
  value: Allergen[]
  onChange: (next: Allergen[]) => void
  disabled?: boolean
  /** Id of an error element outside the picker, added to the group's description. */
  errorId?: string
}

/**
 * The household's allergens to avoid, as nine toggles, with the AI notice
 * under them. Used by onboarding and by the household settings form. The
 * notice is the DPIA's point-of-entry affirmation for Art. 9 allergen data
 * (compliance/dpia.md → Risk area 2, HON-666), so every place that enters
 * allergens renders this one component (HON-1082).
 */
export function AllergenPicker({
  value,
  onChange,
  disabled = false,
  errorId,
}: AllergenPickerProps) {
  const t = useTranslations('household.settings')
  const labelId = useId()
  const noticeId = useId()

  const handleToggle = (allergen: Allergen, pressed: boolean) => {
    onChange(pressed ? [...value, allergen] : value.filter((a) => a !== allergen))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label id={labelId}>{t('allergensLabel')}</Label>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={errorId ? `${noticeId} ${errorId}` : noticeId}
        className="flex flex-wrap gap-2"
      >
        {ALLERGEN_VALUES.map((allergen) => (
          <AllergenToggle
            key={allergen}
            value={allergen}
            pressed={value.includes(allergen)}
            disabled={disabled}
            onPressedChange={(pressed) => handleToggle(allergen, pressed)}
          />
        ))}
      </div>
      <Body id={noticeId} variant="muted">
        {t.rich('allergensAiNotice', {
          privacy: (chunks) => (
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">
              {chunks}
            </Link>
          ),
        })}
      </Body>
    </div>
  )
}

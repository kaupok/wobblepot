'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'

export const PORTION_PRESETS: Array<{
  key: 'small' | 'regular' | 'large' | 'extraLarge'
  value: number
}> = [
  { key: 'small', value: 0.75 },
  { key: 'regular', value: 1.0 },
  { key: 'large', value: 1.5 },
  { key: 'extraLarge', value: 2.0 },
]

const CUSTOM = 'custom'

/** The range the member routes accept for `portionMultiplier`. */
export function isValidPortion(value: number | null): value is number {
  return value !== null && value >= 0.5 && value <= 3.0
}

function isPreset(value: number | null) {
  return PORTION_PRESETS.some((preset) => preset.value === value)
}

interface PortionSizeFieldProps {
  /** `null` while the custom input is empty or unparseable. */
  value: number | null
  onValueChange: (value: number | null) => void
  disabled?: boolean
  /** The caller owns the range check (`isValidPortion`) and passes its message. */
  error?: string | null
  /** Id for the field label, which names the chip group. */
  labelId: string
}

/**
 * The member dialogs' portion picker (HON-1021): four preset chips and Custom.
 * The number input only shows while Custom is chosen, so the portion is asked
 * for once. Custom is chosen when the value matches no preset or the user
 * picked it; the flag keeps the input on screen while the user types a value
 * that happens to equal a preset.
 */
export function PortionSizeField({
  value,
  onValueChange,
  disabled,
  error,
  labelId,
}: PortionSizeFieldProps) {
  const t = useTranslations('household.portion')
  const errorId = useId()
  const [customChosen, setCustomChosen] = useState(false)
  const showCustom = customChosen || !isPreset(value)

  const handleChipChange = (next: string) => {
    if (next === CUSTOM) {
      // Keep the current value in the input. Focus stays on the chip, because
      // arrow keys move inside the radio group.
      setCustomChosen(true)
      return
    }
    setCustomChosen(false)
    onValueChange(Number(next))
  }

  return (
    <div className="flex flex-col gap-2">
      <Label id={labelId}>{t('size')}</Label>
      <ChoiceChips
        aria-labelledby={labelId}
        size="sm"
        value={showCustom ? CUSTOM : String(value)}
        onValueChange={handleChipChange}
        options={[
          ...PORTION_PRESETS.map((preset) => ({
            value: String(preset.value),
            label: t('preset', { label: t(preset.key), multiplier: preset.value }),
          })),
          { value: CUSTOM, label: t('custom') },
        ]}
        disabled={disabled}
      />
      {showCustom && (
        <div className="flex items-center gap-2">
          <NumberInput
            value={value}
            onValueChange={(next) => {
              // Typing pins Custom, so a value that equals a preset does not
              // hide the input under the cursor.
              setCustomChosen(true)
              onValueChange(next)
            }}
            className="w-24"
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            aria-label={t('aria')}
          />
          <Body variant="muted">{t('helper')}</Body>
        </div>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  )
}

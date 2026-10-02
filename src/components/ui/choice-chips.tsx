'use client'

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Check } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'

// A pick-one choice shown as a row of chips (HON-828). Radix RadioGroup gives
// the row `radiogroup` / `radio` roles, `aria-checked`, arrow-key movement and
// one tab stop, so the selection is announced rather than carried by fill alone.
//
// The chips borrow `Button`'s look and heights through `buttonVariants`: an
// unselected chip is `outline`, the selected one `default` plus a `Check` icon
// (the non-colour cue docs/DESIGN.md → Color asks for). The icon is only
// mounted on the selected chip, so that chip grows by its width; rows wrap, so
// no space is reserved on the others.

interface ChoiceChipOption {
  value: string
  label: string
}

type ChoiceChipsLabel =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never }

type ChoiceChipsProps = ChoiceChipsLabel & {
  /** `undefined` checks no chip, e.g. a custom value that matches no option. */
  value: string | undefined
  onValueChange: (value: string) => void
  options: ChoiceChipOption[]
  /** `Button`'s sizes: `default` is the 44px touch target below `md`, `sm` 32px. */
  size?: 'default' | 'sm'
  disabled?: boolean
  /** An error or hint about the whole choice, e.g. a form's `FieldError` id. */
  'aria-describedby'?: string
}

function ChoiceChips({
  value,
  onValueChange,
  options,
  size = 'default',
  disabled,
  ...labelProps
}: ChoiceChipsProps) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="choice-chips"
      // Always controlled: Radix reads `undefined` as uncontrolled and would keep
      // its last internal value checked. `''` matches no option.
      value={value ?? ''}
      onValueChange={onValueChange}
      disabled={disabled}
      className="flex flex-wrap gap-2"
      {...labelProps}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          data-slot="choice-chip"
          className={buttonVariants({
            variant: option.value === value ? 'default' : 'outline',
            size,
          })}
        >
          <RadioGroupPrimitive.Indicator asChild>
            <Check aria-hidden="true" className="size-4" />
          </RadioGroupPrimitive.Indicator>
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  )
}

export { ChoiceChips, type ChoiceChipOption }

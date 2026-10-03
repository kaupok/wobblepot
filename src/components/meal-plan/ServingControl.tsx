'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'

interface ServingControlProps {
  servings: number
  householdSize: number
  onServingsChange: (servings: number | null) => Promise<boolean>
  disabled?: boolean
}

const MIN_SERVINGS = 1
const MAX_SERVINGS = 20

// Safe useLayoutEffect that falls back to useEffect on server
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function ServingControl({
  servings,
  householdSize,
  onServingsChange,
  disabled = false,
}: ServingControlProps) {
  const t = useTranslations('meal-plan.serving')
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState(String(servings))
  const [isUpdating, setIsUpdating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isOverridden = servings !== householdSize

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Sync input value when servings prop changes externally
  // Uses useLayoutEffect to avoid visual flash
  useIsomorphicLayoutEffect(() => {
    if (!isEditing) {
      setInputValue(String(servings))
    }
  }, [servings])

  function handleClick() {
    if (disabled || isUpdating) return
    setInputValue(String(servings))
    setIsEditing(true)
  }

  async function handleSubmit() {
    const newValue = parseLocalizedNumber(inputValue, { integer: true })

    // Validate
    if (newValue === null || newValue < MIN_SERVINGS || newValue > MAX_SERVINGS) {
      setInputValue(String(servings))
      setIsEditing(false)
      return
    }

    // No change
    if (newValue === servings) {
      setIsEditing(false)
      return
    }

    setIsUpdating(true)

    // If setting back to household size, pass null to clear the override
    const valueToSave = newValue === householdSize ? null : newValue
    const success = await onServingsChange(valueToSave)

    setIsUpdating(false)

    if (success) {
      setIsEditing(false)
    } else {
      // Revert on error
      setInputValue(String(servings))
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      setInputValue(String(servings))
      setIsEditing(false)
    }
  }

  function handleBlur() {
    handleSubmit()
  }

  if (isEditing) {
    // The field opens inside the same `surface` `lg` badge, in its place. The
    // input is the badge's 24px `text-sm` line, so the badge stays 34px and the
    // badge row does not grow (HON-1025). `text-sm` is 16px here, which also
    // keeps iOS from zooming in on focus. `hitArea="touch"` is for its
    // `overflow-visible`, so the input's focus ring is not clipped.
    return (
      <Badge variant="surface" size="lg" hitArea="touch">
        <span>{t('label')}</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={isUpdating}
          className={cn(
            'h-6 w-12 rounded border px-1 text-center text-sm',
            'focus:border-primary focus:ring-primary focus:ring-1 focus:outline-none',
            isUpdating && 'opacity-50',
          )}
          aria-label={t('ariaLabel')}
        />
      </Badge>
    )
  }

  const isInactive = disabled || isUpdating

  // The cook view's badge row holds the meal's facts in one form: Kid-friendly,
  // the time, and this, a `surface` `lg` badge that is a button (HON-1025).
  // `hitArea="touch"` reaches 8px past the 34px pill, so the target clears the
  // cook view's 44px floor without growing the row. The colour lives on the
  // inner span because the badge owns its own; the pencil sits inside it so it
  // takes the text's colour, and only shows while the control can be used.
  return (
    <Badge asChild variant="surface" size="lg" hitArea="touch">
      <button
        type="button"
        onClick={handleClick}
        disabled={isInactive}
        aria-label={t('ariaButton', { count: servings })}
      >
        <span className={cn('inline-flex items-center gap-1', isOverridden && 'text-info')}>
          {t('labelWithCount', { count: servings })}
          {isOverridden && <span>{t('custom')}</span>}
          {!isInactive && <Pencil className="size-4" aria-hidden="true" />}
        </span>
      </button>
    </Badge>
  )
}

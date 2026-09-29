'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    // `min-h-8 px-3` matches the resting `Button size="sm"`, so the row neither
    // shrinks nor shifts sideways when the field opens.
    return (
      <span className="inline-flex min-h-8 items-center gap-1 px-3 whitespace-nowrap">
        <span className="text-muted-foreground">{t('label')}</span>
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
            'w-12 rounded border px-1 py-0.5 text-center text-sm',
            'focus:border-primary focus:ring-primary focus:ring-1 focus:outline-none',
            isUpdating && 'opacity-50',
          )}
          aria-label={t('ariaLabel')}
        />
      </span>
    )
  }

  const isInactive = disabled || isUpdating

  // `Button` owns the 32px height (HON-811); colour and weight live on the inner
  // span because `shadcn/no-restyle` keeps them off `Button`, and `Body` renders
  // a `<p>`, which a `<button>` cannot contain. The pencil sits inside the span
  // so it takes the text's colour, and only shows while the control can be used.
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClick}
      disabled={isInactive}
      aria-label={t('ariaButton', { count: servings })}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          isOverridden ? 'text-info' : 'text-muted-foreground font-normal',
        )}
      >
        {t('labelWithCount', { count: servings })}
        {isOverridden && <span className="text-xs">{t('custom')}</span>}
        {!isInactive && <Pencil className="size-3.5" aria-hidden="true" />}
      </span>
    </Button>
  )
}

'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { cn } from '@/lib/utils'

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
    const newValue = parseInt(inputValue, 10)

    // Validate
    if (isNaN(newValue) || newValue < MIN_SERVINGS || newValue > MAX_SERVINGS) {
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
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-muted-foreground">Serves</span>
        <input
          ref={inputRef}
          type="number"
          min={MIN_SERVINGS}
          max={MAX_SERVINGS}
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
          aria-label="Number of servings"
        />
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isUpdating}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm transition-colors',
        'hover:bg-muted focus:ring-primary focus:ring-1 focus:outline-none',
        isOverridden && 'font-medium text-blue-600 dark:text-blue-400',
        !isOverridden && 'text-muted-foreground',
        (disabled || isUpdating) && 'cursor-not-allowed opacity-50',
      )}
      aria-label={`Serves ${servings}. Click to edit.`}
    >
      Serves {servings}
      {isOverridden && <span className="text-xs">(custom)</span>}
    </button>
  )
}

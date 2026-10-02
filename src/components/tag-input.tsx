'use client'

import { useState, useCallback, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface TagInputProps {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}

interface TagInputRef {
  /**
   * Add any typed but uncommitted text as a tag and return the resulting tags.
   * The return value is what a submit handler should send: `onChange` only
   * reaches the parent's state on its next render (HON-961).
   */
  commitPendingValue: () => string[]
}

const TagInput = forwardRef<TagInputRef, TagInputProps>(function TagInput(
  { value, onChange, placeholder = 'Type and press Enter', disabled = false, className, id },
  ref,
) {
  const t = useTranslations('common')
  const [inputValue, setInputValue] = useState('')

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim()
      if (!trimmed || value.includes(trimmed)) return value
      const next = [...value, trimmed]
      onChange(next)
      return next
    },
    [value, onChange],
  )

  const removeTag = useCallback(
    (tagToRemove: string) => {
      onChange(value.filter((tag) => tag !== tagToRemove))
    },
    [value, onChange],
  )

  const commitPendingValue = useCallback(() => {
    if (!inputValue.trim()) return value
    setInputValue('')
    return addTag(inputValue)
  }, [inputValue, value, addTag])

  useImperativeHandle(ref, () => ({ commitPendingValue }), [commitPendingValue])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(inputValue)
      setInputValue('')
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      const lastTag = value[value.length - 1]
      if (lastTag) {
        removeTag(lastTag)
      }
    }
  }

  const handleBlur = () => {
    commitPendingValue()
  }

  return (
    <div
      data-testid="tag-input-container"
      className={cn(
        'border-input dark:bg-input/30 min-h-touch flex w-full flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-3 py-1.5 transition-[color,box-shadow] md:min-h-10',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="h-6">
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:bg-muted-foreground/20 rounded-full p-0.5"
              aria-label={t('removeNamed', { name: tag })}
            >
              <X className="size-3.5" />
            </button>
          )}
        </Badge>
      ))}
      <input
        id={id}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? placeholder : ''}
        disabled={disabled}
        // `self-stretch` opts the caret back out of the container's
        // `items-center`, which the badges need but which would otherwise
        // shrink this field to its 24px `text-sm` line box and leave 10px of
        // dead space above and below it inside a 44px control.
        className="placeholder:text-muted-foreground min-w-30 flex-1 self-stretch bg-transparent text-sm outline-none disabled:cursor-not-allowed"
      />
    </div>
  )
})

export { TagInput }
export type { TagInputProps, TagInputRef }

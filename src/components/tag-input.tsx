'use client'

import { useState, useCallback, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
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
  commitPendingValue: () => void
}

const TagInput = forwardRef<TagInputRef, TagInputProps>(function TagInput(
  { value, onChange, placeholder = 'Type and press Enter', disabled = false, className, id },
  ref,
) {
  const [inputValue, setInputValue] = useState('')

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim()
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed])
      }
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
    if (inputValue.trim()) {
      addTag(inputValue)
      setInputValue('')
    }
  }, [inputValue, addTag])

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
        'border-input dark:bg-input/30 min-h-touch flex w-full flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-3 py-1.5 shadow-xs transition-[color,box-shadow] md:min-h-9',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="h-6 gap-1 pr-1 text-xs">
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:bg-muted-foreground/20 rounded-full p-0.5"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
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
        // shrink this field to its 20px line box and leave 12px of dead
        // space above and below it inside a 44px control.
        className="placeholder:text-muted-foreground min-w-[120px] flex-1 self-stretch bg-transparent text-sm outline-none disabled:cursor-not-allowed"
      />
    </div>
  )
})

export { TagInput }
export type { TagInputProps, TagInputRef }

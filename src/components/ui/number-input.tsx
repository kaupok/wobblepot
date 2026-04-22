'use client'

import { forwardRef, useState } from 'react'
import { Input } from './input'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'

type InheritedInputProps = Omit<
  React.ComponentProps<'input'>,
  'type' | 'value' | 'onChange' | 'inputMode'
>

export interface NumberInputProps extends InheritedInputProps {
  value: number | null | undefined
  onValueChange: (value: number | null) => void
  /** Reject fractional values and use `inputMode="numeric"` for mobile keyboards. */
  integer?: boolean
  /** Accepted for forward-compatibility with HON-499 locale threading; currently unused. */
  locale?: string
}

function formatForDisplay(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (!Number.isFinite(value)) return ''
  return String(value)
}

function normalize(value: number | null | undefined): number | null {
  return value === undefined || value === null || !Number.isFinite(value) ? null : value
}

// Bundled into a single state object so updating one field (e.g.
// `lastReported` during onChange) doesn't cause the render-phase sync check
// to misread a stale `prevValue` and resync the draft.
interface SyncState {
  prevValue: number | null
  lastReported: number | null
}

/**
 * Numeric input that accepts both `.` and `,` as decimal separators. Wraps
 * the shared `Input` primitive as `type="text"` with `inputMode="decimal"`
 * (or `"numeric"` for integer mode) so that commas aren't silently filtered
 * by Chromium in English locales — see `parseLocalizedNumber` for parse rules.
 *
 * Internally keeps a string draft so intermediate typing (`1,` → `1,5`) is
 * preserved across re-renders. External `value` changes (e.g. a preset
 * button) resync the draft; internal changes (parent echoing the number we
 * just reported) do not, which would otherwise fight the user's caret. The
 * sync happens during render — not in an effect — per the React 19 derived-
 * state pattern (see react.dev: Storing information from previous renders).
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, integer = false, locale, onBlur, ...rest },
  ref,
) {
  const incoming = normalize(value)
  const [draft, setDraft] = useState(() => formatForDisplay(incoming))
  const [sync, setSync] = useState<SyncState>(() => ({
    prevValue: incoming,
    lastReported: incoming,
  }))

  if (incoming !== sync.prevValue) {
    if (incoming !== sync.lastReported) {
      // External change — resync draft.
      setSync({ prevValue: incoming, lastReported: incoming })
      setDraft(formatForDisplay(incoming))
    } else {
      // Parent merely echoed the value we reported; keep the user's raw
      // typed form so (e.g.) `1,5` isn't overwritten by `1.5`.
      setSync({ prevValue: incoming, lastReported: sync.lastReported })
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setDraft(next)
    const parsed = parseLocalizedNumber(next, { integer, locale })
    setSync((prev) => ({ ...prev, lastReported: parsed }))
    onValueChange(parsed)
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    // On blur, if the draft is unparseable, reset it to the current value's
    // canonical string form. This avoids leaving stale garbage like `1,5x`
    // in the field after the user tabs away. The committed `value` has
    // already been cleared (or kept at its prior value by the parent).
    const parsed = parseLocalizedNumber(draft, { integer, locale })
    if (parsed === null && draft !== '') {
      setDraft(formatForDisplay(incoming))
    }
    onBlur?.(e)
  }

  return (
    <Input
      ref={ref}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      {...rest}
    />
  )
})

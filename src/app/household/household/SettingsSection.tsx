'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { ApiError, apiFetch } from '@/lib/api'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { sameValues, type SettingsValue } from './settings-values'

export interface SectionFieldState {
  /** Disable every control: a member cannot edit, and nothing is edited mid-save. */
  disabled: boolean
  /** The error's id while one shows, for the controls' `aria-describedby`. */
  errorId: string | undefined
}

interface SettingsSectionProps<T extends Record<keyof T, SettingsValue>> {
  /** Prefixes the error's id, so the three sections' ids stay unique. */
  id: string
  heading: string
  /** The PATCH route this section's values go to, as the JSON body. */
  url: string
  isOwner: boolean
  values: T
  saved: T
  /**
   * The values to send, read at submit. Only for a section whose controls hold
   * input that is not in `values` yet (a TagInput's typed text).
   */
  collectValues?: () => T
  /**
   * A catalog message when the values cannot be saved, checked at submit so
   * the user reads what to fix rather than the route's generic 400.
   */
  validate?: (values: T) => string | undefined
  /** After a successful save, with the values that were sent. */
  onSaved: (values: T) => void
  children: (state: SectionFieldState) => ReactNode
}

/**
 * One household settings section: its own form, heading, error and Save button
 * (HON-961). The button renders only while the section differs from its saved
 * values or its save is in flight, so it also says "this is unsaved".
 */
export function SettingsSection<T extends Record<keyof T, SettingsValue>>({
  id,
  heading,
  url,
  isOwner,
  values,
  saved,
  collectValues,
  validate,
  onSaved,
  children,
}: SettingsSectionProps<T>) {
  const t = useTranslations('household.settings')
  const router = useRouter()
  // The message and the values it was about: a failed save's body, or the
  // values that failed `validate`.
  const [error, setError] = useState<{ message: string; values: T } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const headingRef = useRef<HTMLElement>(null)

  const save = useMutation({
    mutationFn: async (body: T) => {
      // The routes are owner-only (they 403 a member), so a non-owner has
      // nothing to save. handleSubmit and the missing button stop them first;
      // this keeps the mutation from relying on either (HON-677). Throw rather
      // than return, so it can never read as a successful save.
      if (!isOwner) throw new Error(t('ownerOnlyNotice'))
      await apiFetch(
        url,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        t('saveFailed'),
      )
    },
    onSuccess: (_data, body) => {
      toast.success(t('savedToast'))
      // The Save button unmounts once the section is clean, and focus on it
      // would fall to <body>. Move it to the heading first, unless the user
      // has already moved on to another section (CLAUDE.md → Focus management).
      const active = document.activeElement
      if (!active || active === document.body || formRef.current?.contains(active)) {
        headingRef.current?.focus()
      }
      onSaved(body)
      router.refresh()
    },
    onError: (err, body) => {
      // The routes' `error` is English (HON-914): log it, render catalog copy.
      // A 403 is the same case the client-side guard throws for; anything
      // else ("Validation failed", a 500) gets the generic save failure.
      console.error(
        `[household-settings] ${id} save failed`,
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      setError({
        message:
          !isOwner || (err instanceof ApiError && err.status === 403)
            ? t('ownerOnlyNotice')
            : t('saveFailed'),
        values: body,
      })
      requestRefocus()
    },
  })

  // A disabled button loses focus in Chromium; after a failure, give it back.
  const { ref: saveButtonRef, requestRefocus } = useRefocusAfterPending(save.isPending)

  const isDirty = !sameValues(values, saved)
  // An error is about the values it was raised for. Any edit, undoing the
  // change included, makes it stale, so it shows only while they still hold.
  const shownError =
    error && !save.isPending && sameValues(values, error.values) ? error.message : ''
  const errorId = shownError ? `${id}-error` : undefined

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isOwner || save.isPending) return
    const body = collectValues ? collectValues() : values
    // Enter in a text field submits even with no button on screen.
    if (sameValues(body, saved)) return
    const invalid = validate?.(body)
    setError(invalid ? { message: invalid, values: body } : null)
    if (!invalid) save.mutate(body)
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-labelledby={`${id}-heading`}>
      <section className="flex flex-col gap-4">
        <Heading ref={headingRef} id={`${id}-heading`} variant="section" as="h2" tabIndex={-1}>
          {heading}
        </Heading>
        {children({ disabled: save.isPending || !isOwner, errorId })}
        {shownError && <FieldError id={errorId}>{shownError}</FieldError>}
        {isOwner && (isDirty || save.isPending) && (
          <Button
            ref={saveButtonRef}
            type="submit"
            className="w-full md:w-auto md:self-start"
            disabled={save.isPending}
          >
            {save.isPending ? t('saving') : t('saveButton')}
          </Button>
        )}
      </section>
    </form>
  )
}

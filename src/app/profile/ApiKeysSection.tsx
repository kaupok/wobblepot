'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body, Code, Heading } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { apiFetch, ApiError } from '@/lib/api'
import { formatLongDate } from '@/lib/i18n/format-dates'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'
import type { Locale } from '@/lib/i18n/locales'

/** One row of `GET /api/auth/user/api-keys` (`ApiKeySummary` on the server). */
export interface ApiKeyRow {
  id: string
  name: string
  start: string
  createdAt: string
  lastUsedAt: string | null
  /** ISO timestamp, or null for a key that does not expire. */
  expiresAt: string | null
  /** Set by the server, so the server and the browser render the same row. */
  expired: boolean
  /** The member the key belongs to, in the owner's household view; null otherwise. */
  memberName: string | null
}

/** A key just made: the only moment its plain text is on the page. */
export interface CreatedApiKey {
  key: string
  name: string
}

export const API_KEYS_QUERY_KEY = ['api-keys'] as const

/** Mirrors `MAX_API_KEY_NAME_LENGTH` in `src/lib/api-keys.ts`, which is server-only. */
const MAX_NAME_LENGTH = 60
/** Mirrors `MAX_API_KEY_EXPIRY_DAYS` in `src/lib/api-keys.ts`. */
const MAX_EXPIRY_DAYS = 365
const COPIED_RESET_MS = 2000

interface ApiKeysSectionProps {
  /** Read by the page on the server, so the list is right on the first paint. */
  initialKeys: ApiKeyRow[]
  /**
   * The household's IANA timezone. Dates render in it, so the server and the
   * browser print the same day and a key used near midnight does not cause a
   * hydration mismatch.
   */
  timeZone: string
  /**
   * The viewer is the household's owner, so the list holds every member's keys
   * with the member's name, and Revoke works on any of them (HON-1221).
   */
  householdView: boolean
}

/**
 * "Screens and scripts" on the profile page (HON-1220): make a read-only API
 * key for a kitchen screen, Home Assistant or a script, optionally with an
 * expiry, see it once, and revoke it. The key works on `GET /api/v1/meal-plan`
 * and `GET /api/v1/shopping-list` only; see docs/API.md. The owner sees and
 * revokes every member's keys (HON-1221).
 *
 * Focus: after Create, focus moves to the new key's heading, so a screen
 * reader announces it; Done returns it to the name field. A failed Create
 * returns it to Create. Revoke asks first, like Disconnect.
 */
export function ApiKeysSection({ initialKeys, timeZone, householdView }: ApiKeysSectionProps) {
  const t = useTranslations('profile.apiKeys')
  const locale = useLocale() as Locale
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  // Text, not a number: text that is not a whole number must show an error,
  // not read as "no expiry".
  const [expiry, setExpiry] = useState('')
  const [expiryError, setExpiryError] = useState('')
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Kept after the dialog closes, so the title does not blank during the
  // close animation.
  const [subject, setSubject] = useState<ApiKeyRow | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const expiryInputRef = useRef<HTMLInputElement>(null)
  const listHeadingRef = useRef<HTMLDivElement>(null)
  const revokeButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusNameAfterDone = useRef(false)

  const { data: keys = initialKeys, isError } = useQuery({
    queryKey: API_KEYS_QUERY_KEY,
    queryFn: () => apiFetch<ApiKeyRow[]>('/api/auth/user/api-keys'),
    initialData: initialKeys,
  })

  const create = useMutation({
    mutationFn: (input: { name: string; expiresInDays: number | null }) =>
      apiFetch<{ key: string; apiKey: ApiKeyRow }>('/api/auth/user/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ key, apiKey }) => {
      // The POST answers without `memberName`, so in the household view the
      // row comes from the refetch, with its member, not from this answer.
      if (!householdView) {
        queryClient.setQueryData<ApiKeyRow[]>(API_KEYS_QUERY_KEY, (old) => [...(old ?? []), apiKey])
      }
      setCreated({ key, name: apiKey.name })
      setName('')
      setExpiry('')
    },
    // Not returned: a returned promise keeps the mutation pending until the
    // refetch lands, and the name field would come back disabled after Done.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY })
    },
  })
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(create.isPending)

  const revoke = useMutation({
    mutationFn: (row: ApiKeyRow) =>
      apiFetch<void>(`/api/auth/user/api-keys/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, row) => {
      queryClient.setQueryData<ApiKeyRow[]>(API_KEYS_QUERY_KEY, (old) =>
        old?.filter((key) => key.id !== row.id),
      )
      toast.success(t('revoked', { name: row.name }))
    },
    // Catalog copy, not the route's English `error`.
    onError: () => toast.error(t('revokeFailed')),
    onSettled: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY })
    },
  })

  // The form is not rendered while the new key shows, so the name field
  // takes focus back only once Done brought the form back.
  useEffect(() => {
    if (created || !focusNameAfterDone.current) return
    focusNameAfterDone.current = false
    nameInputRef.current?.focus()
  }, [created])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setExpiryError('')

    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('nameRequired'))
      return
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(t('nameTooLong'))
      return
    }
    const expiryText = expiry.trim()
    const expiresInDays = expiryText ? parseLocalizedNumber(expiryText, { integer: true }) : null
    if (
      expiryText &&
      (expiresInDays === null || expiresInDays < 1 || expiresInDays > MAX_EXPIRY_DAYS)
    ) {
      setExpiryError(t('expiryInvalid'))
      expiryInputRef.current?.focus()
      return
    }

    create.mutate(
      { name: trimmed, expiresInDays },
      {
        onError: (err) => {
          // The route's `error` is English and for logs; the code picks the copy.
          console.error('[api-keys] create failed', err.message)
          if (err instanceof ApiError && err.code === 'invalid_expiry') {
            setExpiryError(t('expiryInvalid'))
          } else {
            setError(
              err instanceof ApiError && err.code === 'key_limit'
                ? t('keyLimit')
                : t('createFailed'),
            )
          }
          requestRefocus()
        },
      },
    )
  }

  const handleDone = () => {
    focusNameAfterDone.current = true
    setCreated(null)
  }

  return (
    <section aria-labelledby="api-keys-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Heading variant="section" as="h2" id="api-keys-heading">
          {t('heading')}
        </Heading>
        <Body variant="muted">{t('description')}</Body>
      </div>

      {created ? (
        <NewApiKey created={created} onDone={handleDone} />
      ) : (
        // `noValidate`: an empty name shows catalog copy, not the browser's bubble.
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKeyName">{t('nameLabel')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <Input
                  ref={nameInputRef}
                  id="apiKeyName"
                  name="name"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={MAX_NAME_LENGTH}
                  disabled={create.isPending}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={
                    error ? 'api-key-name-hint api-key-name-error' : 'api-key-name-hint'
                  }
                />
              </div>
              <Button ref={submitRef} type="submit" disabled={create.isPending}>
                {create.isPending ? t('creating') : t('create')}
              </Button>
            </div>
            <Body variant="small" tone="muted" id="api-key-name-hint">
              {t('nameHint')}
            </Body>
            {error && <FieldError id="api-key-name-error">{error}</FieldError>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKeyExpiry">{t('expiryLabel')}</Label>
            <div className="w-32">
              <Input
                ref={expiryInputRef}
                id="apiKeyExpiry"
                name="expiresInDays"
                autoComplete="off"
                inputMode="numeric"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                disabled={create.isPending}
                aria-invalid={expiryError ? true : undefined}
                aria-describedby={
                  expiryError ? 'api-key-expiry-hint api-key-expiry-error' : 'api-key-expiry-hint'
                }
              />
            </div>
            <Body variant="small" tone="muted" id="api-key-expiry-hint">
              {t('expiryHint')}
            </Body>
            {expiryError && <FieldError id="api-key-expiry-error">{expiryError}</FieldError>}
          </div>
        </form>
      )}

      <div className="flex flex-col gap-2">
        {/* Focus lands here when Revoke removed the row that opened the dialog. */}
        <div ref={listHeadingRef} tabIndex={-1} className="outline-none">
          <Heading variant="caption" as="h3">
            {householdView ? t('householdListHeading') : t('listHeading')}
          </Heading>
        </div>

        {isError && <Body tone="destructive">{t('loadFailed')}</Body>}

        {keys.length === 0 ? (
          <Body variant="muted">{householdView ? t('householdEmpty') : t('empty')}</Body>
        ) : (
          <ul className="flex flex-col divide-y">
            {keys.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Body>{row.name}</Body>
                  {householdView && row.memberName && (
                    <Body variant="muted">{t('member', { name: row.memberName })}</Body>
                  )}
                  <div>
                    <Code>{`${row.start}…`}</Code>
                  </div>
                  <Body variant="muted">
                    {t('createdOn', {
                      date: formatLongDate(new Date(row.createdAt), locale, { timeZone }),
                    })}
                  </Body>
                  <Body variant="muted">
                    {row.lastUsedAt
                      ? t('lastUsedOn', {
                          date: formatLongDate(new Date(row.lastUsedAt), locale, { timeZone }),
                        })
                      : t('neverUsed')}
                  </Body>
                  {row.expired ? (
                    <Body tone="destructive">{t('expired')}</Body>
                  ) : (
                    row.expiresAt && (
                      <Body variant="muted">
                        {t('expiresOn', {
                          date: formatLongDate(new Date(row.expiresAt), locale, { timeZone }),
                        })}
                      </Body>
                    )
                  )}
                </div>
                <Button
                  ref={(node) => {
                    if (node) revokeButtonRefs.current.set(row.id, node)
                    else revokeButtonRefs.current.delete(row.id)
                  }}
                  type="button"
                  variant="outline"
                  aria-label={
                    householdView && row.memberName
                      ? t('revokeMemberLabel', { name: row.name, member: row.memberName })
                      : t('revokeLabel', { name: row.name })
                  }
                  onClick={() => {
                    setSubject(row)
                    setDialogOpen(true)
                  }}
                >
                  {t('revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          // The request cannot be cancelled, so the dialog stays until it settles.
          if (!open && !revoke.isPending) setDialogOpen(false)
        }}
        title={subject ? t('confirmTitle', { name: subject.name }) : ''}
        description={t('confirmDescription')}
        confirmLabel={t('revoke')}
        loadingLabel={t('revoking')}
        variant="destructive"
        isLoading={revoke.isPending}
        onConfirm={() => {
          if (subject) revoke.mutate(subject)
        }}
        onCloseAutoFocus={(event) => {
          // Opened from state, so Radix has no trigger to return focus to:
          // back to the row's Revoke button, or to the list heading when
          // Revoke removed the row.
          event.preventDefault()
          const button = subject ? revokeButtonRefs.current.get(subject.id) : undefined
          if (button?.isConnected) button.focus()
          else listHeadingRef.current?.focus()
        }}
      />
    </section>
  )
}

interface NewApiKeyProps {
  created: CreatedApiKey
  onDone: () => void
}

/**
 * The key just made, with Copy, shown once: the server keeps only its hash.
 * Its heading takes focus when it appears, so a screen reader reads it.
 */
export function NewApiKey({ created, onDone }: NewApiKeyProps) {
  const t = useTranslations('profile.apiKeys')
  const [copied, setCopied] = useState(false)
  const headingRef = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    headingRef.current?.focus()
    return () => clearTimeout(resetTimer.current ?? undefined)
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(created.key)
    } catch {
      toast.error(t('copyFailed'))
      return
    }
    toast.success(t('copySuccess'))
    setCopied(true)
    clearTimeout(resetTimer.current ?? undefined)
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={headingRef} tabIndex={-1} className="outline-none">
        <Heading variant="caption" as="h3">
          {t('newKeyHeading', { name: created.name })}
        </Heading>
      </div>
      <Callout tone="warning">{t('newKeyWarning')}</Callout>
      <div className="flex flex-wrap items-center gap-2">
        {/* The key must wrap rather than widen the page on a phone. */}
        <div className="min-w-0 break-all">
          <Code>{created.key}</Code>
        </div>
        <Button type="button" variant="outline" onClick={handleCopy}>
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      <Body variant="muted">{t('newKeyUsage')}</Body>
      <div>
        <Button type="button" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  )
}

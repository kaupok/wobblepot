'use client'

import { useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Body, Heading } from '@/components/ui/typography'
import { apiFetch } from '@/lib/api'
import { formatLongDate } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { SCOPE_MESSAGE_KEYS, knownScopes } from '@/lib/mcp/oauth'

/** One row of `GET /api/auth/user/mcp-consents` (`McpConsentSummary` on the server). */
export interface ConnectedAssistant {
  clientId: string
  clientName: string | null
  scopes: string[]
  createdAt: string | null
}

export const MCP_CONSENTS_QUERY_KEY = ['mcp-consents'] as const

interface ConnectedAssistantsListProps {
  /** Read by the page on the server, so the list is right on the first paint. */
  initialConsents: ConnectedAssistant[]
  /**
   * The household's IANA timezone. Dates render in it, so the server and the
   * browser print the same day and a consent made near midnight does not cause
   * a hydration mismatch.
   */
  timeZone: string
}

/**
 * "Connected assistants" on My account → Connections (HON-1153): one row per AI
 * assistant the user allowed on `/consent`, with Disconnect. Disconnect asks
 * first, because the assistant stops working at once.
 */
export function ConnectedAssistantsList({
  initialConsents,
  timeZone,
}: ConnectedAssistantsListProps) {
  const t = useTranslations('account.assistants')
  const locale = useLocale() as Locale
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  // Kept after the dialog closes, so the title does not blank during the
  // close animation.
  const [subject, setSubject] = useState<ConnectedAssistant | null>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())

  const nameOf = (consent: ConnectedAssistant) => consent.clientName ?? t('unnamed')

  const { data: consents = initialConsents, isError } = useQuery({
    queryKey: MCP_CONSENTS_QUERY_KEY,
    queryFn: () => apiFetch<ConnectedAssistant[]>('/api/auth/user/mcp-consents'),
    initialData: initialConsents,
  })

  const disconnect = useMutation({
    mutationFn: (consent: ConnectedAssistant) =>
      apiFetch<void>(`/api/auth/user/mcp-consents/${encodeURIComponent(consent.clientId)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, consent) => {
      queryClient.setQueryData<ConnectedAssistant[]>(MCP_CONSENTS_QUERY_KEY, (old) =>
        old?.filter((row) => row.clientId !== consent.clientId),
      )
      toast.success(t('disconnected', { name: nameOf(consent) }))
    },
    // Catalog copy, not the route's English `error`.
    onError: () => toast.error(t('disconnectFailed')),
    onSettled: () => {
      setDialogOpen(false)
      return queryClient.invalidateQueries({ queryKey: MCP_CONSENTS_QUERY_KEY })
    },
  })

  const scopeLine = (scopes: string[]) =>
    knownScopes(scopes.join(' '))
      .map((scope) => t(`scopes.${SCOPE_MESSAGE_KEYS[scope]}`))
      .join(' · ')

  return (
    <div className="flex flex-col gap-2">
      {/* Focus lands here when Disconnect removed the row that opened the dialog. */}
      <div ref={headingRef} tabIndex={-1} className="outline-none">
        <Heading variant="section" as="h3">
          {t('listHeading')}
        </Heading>
      </div>

      {isError && <Body tone="destructive">{t('loadFailed')}</Body>}

      {consents.length === 0 ? (
        <Body variant="muted">{t('empty')}</Body>
      ) : (
        <ul className="flex flex-col divide-y">
          {consents.map((consent) => {
            const scopes = scopeLine(consent.scopes)
            return (
              <li
                key={consent.clientId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <Body>{nameOf(consent)}</Body>
                  {consent.createdAt && (
                    <Body variant="muted">
                      {t('connectedOn', {
                        date: formatLongDate(new Date(consent.createdAt), locale, { timeZone }),
                      })}
                    </Body>
                  )}
                  {scopes && <Body variant="muted">{scopes}</Body>}
                </div>
                <Button
                  ref={(node) => {
                    if (node) buttonRefs.current.set(consent.clientId, node)
                    else buttonRefs.current.delete(consent.clientId)
                  }}
                  type="button"
                  variant="outline"
                  aria-label={t('disconnectLabel', { name: nameOf(consent) })}
                  onClick={() => {
                    setSubject(consent)
                    setDialogOpen(true)
                  }}
                >
                  {t('disconnect')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          // The request cannot be cancelled, so the dialog stays until it settles.
          if (!open && !disconnect.isPending) setDialogOpen(false)
        }}
        title={subject ? t('confirmTitle', { name: nameOf(subject) }) : ''}
        description={t('confirmDescription')}
        confirmLabel={t('disconnect')}
        loadingLabel={t('disconnecting')}
        variant="destructive"
        isLoading={disconnect.isPending}
        onConfirm={() => {
          if (subject) disconnect.mutate(subject)
        }}
        onCloseAutoFocus={(event) => {
          // Opened from state, so Radix has no trigger to return focus to:
          // back to the row's Disconnect button, or to the heading when
          // Disconnect removed the row.
          event.preventDefault()
          const button = subject ? buttonRefs.current.get(subject.clientId) : undefined
          if (button?.isConnected) button.focus()
          else headingRef.current?.focus()
        }}
      />
    </div>
  )
}

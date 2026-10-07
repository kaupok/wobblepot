'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch, ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/i18n/format-dates'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import type { WaitlistRow } from '@/lib/waitlist'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Body, Heading } from '@/components/ui/typography'

interface WaitlistResponse {
  requests: WaitlistRow[]
}

const QUERY_KEY = ['admin', 'waitlist'] as const

function formatAt(iso: string): string {
  return formatDateTime(new Date(iso), DEFAULT_LOCALE)
}

function inviteErrorMessage(err: Error): string {
  if (err instanceof ApiError && err.code === 'ACCOUNT_EXISTS') {
    return 'This address already has an account. Remove the request instead.'
  }
  if (err instanceof ApiError && err.code === 'INVITE_CONFLICT') {
    return 'Another invite to this address was sent at the same time. Only that one counts.'
  }
  if (err instanceof ApiError && err.status === 503) return 'Email is not configured here.'
  if (err instanceof ApiError && err.status === 502) {
    return 'The invite email did not send. Try again.'
  }
  if (err instanceof ApiError && err.status === 404) return 'This request no longer exists.'
  return 'Could not send the invite. Try again.'
}

interface WaitlistClientProps {
  initialRequests: WaitlistRow[]
}

export function WaitlistClient({ initialRequests }: WaitlistClientProps) {
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState<WaitlistRow | null>(null)
  // The Remove button that opened the dialog, for focus on close.
  const removeTriggerRef = useRef<HTMLElement | null>(null)
  // Focus target once a Remove took its row, and with it the trigger, away.
  const listHeadingRef = useRef<HTMLElement | null>(null)
  const removedRef = useRef(false)

  const { data } = useQuery<WaitlistResponse>({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<WaitlistResponse>('/api/admin/waitlist'),
    initialData: { requests: initialRequests },
  })

  const inviteMutation = useMutation({
    mutationFn: (row: WaitlistRow) =>
      apiFetch<{ invitedAt: string | null }>(
        `/api/admin/waitlist/${encodeURIComponent(row.id)}/invite`,
        { method: 'POST' },
      ),
    onSuccess: (_data, row) => toast.success(`Invite sent to ${row.email}`),
    onError: (err: Error) => toast.error(inviteErrorMessage(err)),
    // Refetch either way: a 404 means the row is gone, and the list should say so.
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const removeMutation = useMutation({
    mutationFn: (row: WaitlistRow) =>
      apiFetch<{ ok: true }>(`/api/admin/waitlist/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, row) => {
      // Drop the row now rather than on the refetch, so the list and focus do
      // not depend on its timing.
      queryClient.setQueryData<WaitlistResponse>(QUERY_KEY, (old) =>
        old ? { requests: old.requests.filter((r) => r.id !== row.id) } : old,
      )
      removedRef.current = true
      setRemoving(null)
      toast.success(`Removed ${row.email}`)
    },
    onError: () => toast.error('Could not remove the request. Try again.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const requests = data?.requests ?? []

  return (
    <>
      <Card>
        <CardHeader>
          <Heading variant="section" as="h2" ref={listHeadingRef} tabIndex={-1}>
            Confirmed requests
          </Heading>
          <Body variant="muted">
            Newest confirmation first. An invite code works for 14 days and once.
          </Body>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <Body variant="muted">No confirmed requests yet.</Body>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="waitlist-list">
              {requests.map((row) => {
                const inviting = inviteMutation.isPending && inviteMutation.variables?.id === row.id
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-1">
                      <Body>{row.email}</Body>
                      <Body variant="small" tone="muted">
                        {row.locale} · Source: {row.source ?? 'direct'} · Confirmed{' '}
                        {formatAt(row.confirmedAt)}
                        {row.invitedAt ? ` · Invited ${formatAt(row.invitedAt)}` : ' · Not invited'}
                      </Body>
                    </div>
                    <div className="flex gap-2">
                      {/* aria-disabled, not disabled, so focus stays on the button
                          while the request is pending (CLAUDE.md → Focus management). */}
                      <Button
                        type="button"
                        size="sm"
                        aria-disabled={inviting}
                        onClick={() => {
                          if (!inviteMutation.isPending) inviteMutation.mutate(row)
                        }}
                        aria-label={`${row.invitedAt ? 'Send again' : 'Send invite'} to ${row.email}`}
                      >
                        {inviting ? 'Sending...' : row.invitedAt ? 'Send again' : 'Send invite'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          removeTriggerRef.current = e.currentTarget
                          setRemoving(row)
                        }}
                        aria-label={`Remove ${row.email}`}
                      >
                        Remove
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !removeMutation.isPending) setRemoving(null)
        }}
        title="Remove this request?"
        description={
          removing
            ? `${removing.email} leaves the waitlist. A code already sent stays valid until it expires.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        loadingLabel="Removing..."
        variant="destructive"
        isLoading={removeMutation.isPending}
        onConfirm={() => {
          if (removing) removeMutation.mutate(removing)
        }}
        onCloseAutoFocus={(event) => {
          // Opened from state, so Radix has no trigger to return focus to, and
          // after a Remove the button is gone with its row (CLAUDE.md → Focus
          // management). Pick the target here every time.
          event.preventDefault()
          const trigger = removeTriggerRef.current
          if (!removedRef.current && trigger?.isConnected) {
            trigger.focus()
          } else {
            listHeadingRef.current?.focus()
          }
          removedRef.current = false
        }}
      />
    </>
  )
}

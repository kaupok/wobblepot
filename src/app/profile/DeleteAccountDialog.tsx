'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { ApiError, apiFetch } from '@/lib/api'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { formatLongDate } from '@/lib/i18n/format-dates'
import type { Locale } from '@/lib/i18n/locales'
import { translateErrorCode } from '@/lib/ai/error-codes'
import { ACCOUNT_DELETION_ERROR_KEYS } from '@/lib/account-deletion-error-codes'

interface DeleteAccountDialogProps {
  userEmail: string
  householdName?: string
  isOwner?: boolean
  memberCount?: number
}

export function DeleteAccountDialog({
  userEmail,
  householdName,
  isOwner,
  memberCount,
}: DeleteAccountDialogProps) {
  const t = useTranslations('profile.delete')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const { purgeScheduledFor } = await apiFetch<{ purgeScheduledFor?: string }>(
        '/api/auth/user',
        { method: 'DELETE' },
      )

      // Surface the scheduled purge date returned by the route. The Toaster is
      // mounted at the root layout, so this survives the redirect below.
      // `formatLongDate` is the same helper the confirmation email formats with,
      // so the two channels quote the user an identical date string (HON-705).
      // Pinned to UTC for the same reason the email is: `purgeScheduledFor` is a
      // UTC instant and the purge cron runs at 03:00 UTC, so the browser zone
      // could otherwise show a different calendar day (see HON-481 review).
      if (purgeScheduledFor) {
        const date = formatLongDate(new Date(purgeScheduledFor), locale, { timeZone: 'UTC' })
        toast.success(t('scheduledToast', { date }))
      }

      // Sign out and redirect. Inside the mutation, so a sign-out failure lands
      // in `onError` like any other.
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Fire-and-forget: account is already deleted, so an analytics
            // chunk-load failure must not block the post-delete redirect.
            import('posthog-js').then(({ default: posthog }) => posthog.reset()).catch(() => {})
            router.push('/')
            router.refresh()
          },
        },
      })
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) {
        setError(t('errors.unexpected'))
        return
      }
      // The route's `message` is English on every branch, so the `code`
      // picks the copy; the prose is kept as a console breadcrumb only
      // (HON-725).
      const body = err.body as {
        error?: unknown
        message?: unknown
        householdName?: unknown
        otherMemberCount?: unknown
      }
      console.error('[delete-account] request failed', {
        code: err.code,
        error: body.error,
        message: body.message,
      })
      const key = translateErrorCode(err.code, ACCOUNT_DELETION_ERROR_KEYS, 'deleteFailed')
      setError(
        t(`errors.${key}`, {
          householdName: typeof body.householdName === 'string' ? body.householdName : '',
          count: typeof body.otherMemberCount === 'number' ? body.otherMemberCount : 0,
        }),
      )
    },
  })

  // A successful delete stays "deleting" until the redirect lands: the account
  // is gone, so the buttons must not come back to life in between.
  const isDeleting = deleteAccount.isPending || deleteAccount.isSuccess

  const handleDelete = () => {
    setError('')
    deleteAccount.mutate()
  }

  const hasOtherMembers = Boolean(isOwner && memberCount && memberCount > 1)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">{t('trigger')}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3">
              <Body variant="muted">{t('confirmation')}</Body>

              <Body variant="muted">{t('willDelete')}</Body>
              <ul className="text-muted-foreground list-inside list-disc text-sm">
                <li>{t('list.profile')}</li>
                <li>{t('list.preferences')}</li>
                {isOwner && householdName && !hasOtherMembers && (
                  <li>{t('list.householdAll', { householdName })}</li>
                )}
                {!isOwner && householdName && <li>{t('list.membership', { householdName })}</li>}
              </ul>

              <Body variant="muted">{t('graceNote')}</Body>

              {hasOtherMembers && (
                <Body variant="paragraph" tone="destructive">
                  {t('cannotDeleteOwner', {
                    householdName: householdName ?? '',
                    count: (memberCount ?? 1) - 1,
                  })}
                </Body>
              )}

              <Body variant="muted">{t('accountLine', { email: userEmail })}</Body>

              {error && <FieldError>{error}</FieldError>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // `AlertDialogAction` closes the dialog on click unless the event
              // is cancelled. Keep it open so the pending label and any error
              // below are actually seen; a successful delete redirects away
              // (HON-725).
              event.preventDefault()
              handleDelete()
            }}
            disabled={isDeleting || hasOtherMembers}
            className={buttonVariants({ variant: 'destructive' })}
          >
            {isDeleting ? t('deleting') : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

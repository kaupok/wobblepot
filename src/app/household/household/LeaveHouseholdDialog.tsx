'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
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
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

interface LeaveHouseholdDialogProps {
  householdName: string
  isOwner: boolean
  /**
   * Members of the household with their own account, the user included. An
   * owner can leave only when this is 1, and then the household is deleted
   * (HON-1133). Same count as `DeleteAccountDialog` and the leave route.
   */
  accountMemberCount: number
}

/**
 * The Leave household section on `/household`: one line of consequence and a
 * confirm. An owner with other account holders gets the reason in place of
 * the button, as `DeleteAccountDialog` does for account deletion.
 */
export function LeaveHouseholdDialog({
  householdName,
  isOwner,
  accountMemberCount,
}: LeaveHouseholdDialogProps) {
  const t = useTranslations('household.leave')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  const leave = useMutation({
    mutationFn: () =>
      apiFetch<{ deletedHousehold: boolean }>('/api/households/me/leave', {
        method: 'POST',
      }),
    onSuccess: () => {
      // With no household the root layout sends the user to onboarding anyway;
      // going there directly skips a redirect.
      router.push('/onboarding')
      router.refresh()
    },
    onError: (err) => {
      requestRefocus()
      // The route's `error` is a code; the copy comes from the catalog.
      const body = err instanceof ApiError ? (err.body as { error?: unknown; count?: unknown }) : {}
      console.error('[leave-household] request failed', { error: body.error })
      setError(
        body.error === 'owner_has_other_accounts'
          ? t('cannotLeave', { count: typeof body.count === 'number' ? body.count : 1 })
          : t('errors.failed'),
      )
    },
  })

  // A successful leave stays "leaving" until the redirect lands: the
  // membership is gone, so the buttons must not come back to life.
  const isLeaving = leave.isPending || leave.isSuccess
  // The confirm is disabled while pending, which blurs it; a failed leave
  // puts focus back on it (CLAUDE.md → Focus management).
  const { ref: confirmRef, requestRefocus } = useRefocusAfterPending(leave.isPending)
  const otherAccountCount = accountMemberCount - 1
  const blocked = isOwner && otherAccountCount > 0
  const deletesHousehold = isOwner && !blocked

  return (
    <div className="flex flex-col gap-3">
      <Body variant="muted">
        {deletesHousehold ? t('descriptionOwner') : t('descriptionMember')}
      </Body>
      {blocked ? (
        <Body variant="paragraph" tone="destructive">
          {t('cannotLeave', { count: otherAccountCount })}
        </Body>
      ) : (
        <div>
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              if (isLeaving) return
              setOpen(next)
              if (!next) setError('')
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full md:w-auto">
                {t('trigger')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('title')}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="flex flex-col gap-3">
                    <Body variant="muted">
                      {deletesHousehold
                        ? t('bodyOwner', { householdName })
                        : t('bodyMember', { householdName })}
                    </Body>
                    {deletesHousehold && <Body variant="muted">{t('exportNote')}</Body>}
                    {error && <FieldError>{error}</FieldError>}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isLeaving}>{tCommon('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  ref={confirmRef}
                  onClick={(event) => {
                    // Keep the dialog open so the pending label and any error
                    // are seen; a successful leave redirects away.
                    event.preventDefault()
                    setError('')
                    leave.mutate()
                  }}
                  disabled={isLeaving}
                  className={buttonVariants({ variant: 'destructive' })}
                >
                  {isLeaving ? t('leaving') : t('confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  )
}

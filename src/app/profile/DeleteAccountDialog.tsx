'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
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
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const handleDelete = async () => {
    setIsDeleting(true)
    setError('')

    try {
      const response = await fetch('/api/auth/user', {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.message || t('errors.deleteFailed'))
        setIsDeleting(false)
        return
      }

      // Surface the scheduled purge date returned by the route. The Toaster is
      // mounted at the root layout, so this survives the redirect below.
      const { purgeScheduledFor } = (await response.json()) as { purgeScheduledFor?: string }
      if (purgeScheduledFor) {
        toast.success(t('scheduledToast', { date: new Date(purgeScheduledFor) }))
      }

      // Sign out and redirect
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
    } catch {
      setError(t('errors.unexpected'))
      setIsDeleting(false)
    }
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
                <Body variant="muted" className="text-destructive">
                  {t('cannotDeleteOwner', {
                    householdName: householdName ?? '',
                    count: (memberCount ?? 1) - 1,
                  })}
                </Body>
              )}

              <Body variant="small" className="text-muted-foreground">
                {t('accountLine', { email: userEmail })}
              </Body>

              {error && <Body className="text-destructive">{error}</Body>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting || hasOtherMembers}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? t('deleting') : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

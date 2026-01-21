'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
        setError(data.message || 'Failed to delete account')
        setIsDeleting(false)
        return
      }

      // Sign out and redirect
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push('/')
            router.refresh()
          },
        },
      })
    } catch {
      setError('An unexpected error occurred')
      setIsDeleting(false)
    }
  }

  const hasOtherMembers = Boolean(isOwner && memberCount && memberCount > 1)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete account</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3">
              <Body variant="muted">
                Are you sure you want to delete your account? This action cannot be undone.
              </Body>

              <Body variant="muted">The following will be permanently deleted:</Body>
              <ul className="text-muted-foreground list-inside list-disc text-sm">
                <li>Your profile and account data</li>
                <li>Your preferences and settings</li>
                {isOwner && householdName && !hasOtherMembers && (
                  <li>
                    Your household &quot;{householdName}&quot; and all its data (meal plans, pantry
                    items, etc.)
                  </li>
                )}
                {!isOwner && householdName && (
                  <li>Your membership in &quot;{householdName}&quot;</li>
                )}
              </ul>

              {hasOtherMembers && (
                <Body variant="muted" className="text-destructive">
                  Warning: You cannot delete your account because you are the owner of &quot;
                  {householdName}&quot; with {memberCount! - 1} other member(s). Please transfer
                  ownership or remove other members first.
                </Body>
              )}

              <Body variant="small" className="text-muted-foreground">
                Account: {userEmail}
              </Body>

              {error && <Body className="text-destructive">{error}</Body>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting || hasOtherMembers}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete account'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

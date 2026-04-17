'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { MemberInvite } from '@/types/member'

interface MemberInviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  memberId: string
  memberName: string
  existingInvite: MemberInvite | null
  onInviteCreated: (invite: MemberInvite) => void
}

export function MemberInviteDialog({
  open,
  onOpenChange,
  memberId,
  memberName,
  existingInvite,
  onInviteCreated,
}: MemberInviteDialogProps) {
  const [error, setError] = useState('')
  const [createdInvite, setCreatedInvite] = useState<MemberInvite | null>(existingInvite)
  const [copied, setCopied] = useState(false)

  const createInvite = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/households/me/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId,
          expiresInDays: 7,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create invite')
      }

      return response.json()
    },
    onSuccess: (invite) => {
      const newInvite: MemberInvite = {
        url: invite.url,
        expiresAt: invite.expiresAt,
        isActive: true,
      }
      setCreatedInvite(newInvite)
      onInviteCreated(newInvite)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'An error occurred')
    },
  })

  const isLoading = createInvite.isPending

  const resetForm = () => {
    setError('')
    setCreatedInvite(existingInvite)
    setCopied(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm()
    } else {
      // Reset to show existing invite when opening
      setCreatedInvite(existingInvite)
    }
    onOpenChange(newOpen)
  }

  const handleCreateInvite = () => {
    setError('')
    createInvite.mutate()
  }

  const handleCopy = async () => {
    if (!createdInvite) return
    try {
      await navigator.clipboard.writeText(createdInvite.url)
      setCopied(true)
      toast.success('Link copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy link. Please copy manually.')
    }
  }

  const displayInvite = createdInvite || existingInvite
  const hasActiveInvite = displayInvite?.isActive

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite {memberName}</DialogTitle>
          <DialogDescription>
            {hasActiveInvite
              ? 'Share this link for them to claim their profile.'
              : 'Create a link for this member to join and claim their profile.'}
          </DialogDescription>
        </DialogHeader>

        {hasActiveInvite && displayInvite ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-link">Invite link</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-link"
                  value={displayInvite.url}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button variant="outline" onClick={handleCopy} className="shrink-0">
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
            <Body variant="muted">
              This invite expires{' '}
              {new Date(displayInvite.expiresAt).toLocaleDateString(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
              .
            </Body>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={handleCreateInvite} disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Generate new link'}
              </Button>
              <Body variant="caption">This will invalidate the current link.</Body>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Body>
              When {memberName} uses this link, they&apos;ll create an account and automatically be
              connected to their existing profile in your household.
            </Body>
            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}
          </div>
        )}

        <DialogFooter>
          {hasActiveInvite ? (
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateInvite} disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Create invite link'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

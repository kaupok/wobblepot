'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
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
  const t = useTranslations('household.invite')
  const locale = useLocale()
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
        throw new Error(data.error || t('errors.createFailed'))
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
      setError(err instanceof Error ? err.message : t('errors.generic'))
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
      toast.success(t('copySuccess'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  const displayInvite = createdInvite || existingInvite
  const hasActiveInvite = displayInvite?.isActive

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: memberName })}</DialogTitle>
          <DialogDescription>
            {hasActiveInvite ? t('descriptionActive') : t('descriptionPending')}
          </DialogDescription>
        </DialogHeader>

        {hasActiveInvite && displayInvite ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-link">{t('linkLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-link"
                  value={displayInvite.url}
                  readOnly
                  className="font-mono text-sm"
                />
                <Button variant="outline" onClick={handleCopy} className="shrink-0">
                  {copied ? t('copied') : t('copy')}
                </Button>
              </div>
            </div>
            <Body variant="muted">
              {t('expires', {
                date: new Date(displayInvite.expiresAt).toLocaleDateString(locale, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
              })}
            </Body>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={handleCreateInvite} disabled={isLoading}>
                {isLoading ? t('regenerating') : t('regenerate')}
              </Button>
              <Body variant="caption">{t('regenerateWarning')}</Body>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Body>{t('body', { name: memberName })}</Body>
            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}
          </div>
        )}

        <DialogFooter>
          {hasActiveInvite ? (
            <Button onClick={() => handleOpenChange(false)}>{t('done')}</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button onClick={handleCreateInvite} disabled={isLoading}>
                {isLoading ? t('creating') : t('create')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

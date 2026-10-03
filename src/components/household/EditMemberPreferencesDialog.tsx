'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
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
import type { Member } from '@/types/member'
import { FieldError } from '@/components/FieldError'
import { ApiError, apiFetch } from '@/lib/api'
import { PortionSizeField, isValidPortion } from './PortionSizeField'

// A member without an account has one name: a display name set before
// HON-1021 is shown in the Name field and folded into it on save.
function initialName(member: Member | null) {
  return member?.preferences?.displayName || member?.name || ''
}

interface EditMemberPreferencesDialogProps {
  member: Member | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (member: Member) => void
  isManualMember: boolean
  /** Opened from state with no trigger: where focus goes when it closes. */
  onCloseAutoFocus?: (event: Event) => void
}

export function EditMemberPreferencesDialog({
  member,
  open,
  onOpenChange,
  onSaved,
  isManualMember,
  onCloseAutoFocus,
}: EditMemberPreferencesDialogProps) {
  const t = useTranslations('household.editMember')
  const tPortion = useTranslations('household.portion')

  // Member name (only for manual members)
  const [name, setName] = useState(initialName(member))

  // Preferences state (display name only for account members)
  const [displayName, setDisplayName] = useState(member?.preferences?.displayName || '')
  const [portionMultiplier, setPortionMultiplier] = useState<number | null>(
    member?.preferences?.portionMultiplier || 1.0,
  )
  const [portionError, setPortionError] = useState<string | null>(null)

  // Form state
  const [error, setError] = useState('')

  const saveMember = useMutation({
    mutationFn: ({ memberId, payload }: { memberId: string; payload: Record<string, unknown> }) =>
      apiFetch<Member>(
        `/api/households/me/members/${memberId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        t('errors.saveFailed'),
      ),
    onSuccess: (updatedMember) => {
      onSaved(updatedMember)
      onOpenChange(false)
      toast.success(t('savedToast'))
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      // The form already gates who can edit what, so no failure it sends has
      // a next step beyond retrying.
      console.error(
        '[edit-member] save failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      setError(t('errors.saveFailed'))
    },
  })

  const isLoading = saveMember.isPending

  // Reset form when member changes — during render rather than in an effect,
  // so the dialog never paints the previous member's values first.
  const [formMember, setFormMember] = useState(member)
  if (member !== formMember) {
    setFormMember(member)
    if (member) {
      setName(initialName(member))
      setDisplayName(member.preferences?.displayName || '')
      setPortionMultiplier(member.preferences?.portionMultiplier || 1.0)
      setError('')
      setPortionError(null)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!member) return

    setError('')

    const trimmedName = name.trim()
    if (isManualMember && !trimmedName) {
      setError(t('errors.nameRequired'))
      return
    }

    if (!isValidPortion(portionMultiplier)) {
      setPortionError(tPortion('invalid'))
      return
    }

    // A manual member's typed name replaces both `name` and any old display
    // name. An account member keeps a separate display name, because their
    // account name is fixed.
    const payload: Record<string, unknown> = isManualMember
      ? { name: trimmedName, preferences: { displayName: null, portionMultiplier } }
      : { preferences: { displayName: displayName.trim() || null, portionMultiplier } }

    saveMember.mutate({ memberId: member.id, payload })
  }

  const handlePortionChange = (value: number | null) => {
    setPortionMultiplier(value)
    // An empty input is not flagged while typing; submit catches it.
    setPortionError(value === null || isValidPortion(value) ? null : tPortion('invalid'))
  }

  const memberDisplayName =
    member?.preferences?.displayName || member?.user?.name || member?.name || t('fallbackName')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('title', { name: memberDisplayName })}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-4">
            {/* A manual member has one name; an account member's name is fixed,
                so the household can give them a display name instead. */}
            {isManualMember ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">{t('nameLabel')}</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder={t('namePlaceholder')}
                  disabled={isLoading}
                  required
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="displayName">{t('displayNameOptionalLabel')}</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={50}
                  placeholder={t('displayNamePlaceholder')}
                  disabled={isLoading}
                />
                <Body variant="muted">{t('displayNameHelper')}</Body>
              </div>
            )}

            <PortionSizeField
              labelId="edit-member-portion-label"
              value={portionMultiplier}
              onValueChange={handlePortionChange}
              disabled={isLoading}
              error={portionError}
            />

            {error && <FieldError>{error}</FieldError>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

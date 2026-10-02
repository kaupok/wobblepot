'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { ChoiceChips } from '@/components/ui/choice-chips'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
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

const PORTION_PRESETS: Array<{ key: 'small' | 'regular' | 'large' | 'extraLarge'; value: number }> =
  [
    { key: 'small', value: 0.75 },
    { key: 'regular', value: 1.0 },
    { key: 'large', value: 1.5 },
    { key: 'extraLarge', value: 2.0 },
  ]

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
  const [name, setName] = useState(member?.name || '')

  // Preferences state
  const [displayName, setDisplayName] = useState(member?.preferences?.displayName || '')
  const [portionMultiplier, setPortionMultiplier] = useState(
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
      setName(member.name || '')
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

    if (portionMultiplier < 0.5 || portionMultiplier > 3.0) {
      setPortionError(tPortion('invalid'))
      return
    }

    const payload: Record<string, unknown> = {
      preferences: {
        displayName: displayName.trim() || null,
        portionMultiplier,
      },
    }

    // Only include name for manual members
    const trimmedName = name.trim()
    if (isManualMember && trimmedName) {
      payload.name = trimmedName
    }

    saveMember.mutate({ memberId: member.id, payload })
  }

  const handlePortionInputChange = (value: number | null) => {
    if (value === null) {
      setPortionError(null)
      return
    }
    if (value < 0.5 || value > 3.0) {
      setPortionError(tPortion('invalid'))
      return
    }
    setPortionError(null)
    setPortionMultiplier(value)
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
            {/* Member name (only for manual members) */}
            {isManualMember && (
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
                />
              </div>
            )}

            {/* Display name */}
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

            {/* Portion size */}
            <div className="flex flex-col gap-2">
              <Label id="edit-member-portion-label">{tPortion('size')}</Label>
              <ChoiceChips
                aria-labelledby="edit-member-portion-label"
                size="sm"
                // A custom multiplier from the input below can match no preset:
                // then no chip is checked.
                value={
                  PORTION_PRESETS.some((preset) => preset.value === portionMultiplier)
                    ? String(portionMultiplier)
                    : undefined
                }
                onValueChange={(v) => setPortionMultiplier(Number(v))}
                options={PORTION_PRESETS.map((preset) => ({
                  value: String(preset.value),
                  label: tPortion('preset', {
                    label: tPortion(preset.key),
                    multiplier: preset.value,
                  }),
                }))}
                disabled={isLoading}
              />
              <div className="flex items-center gap-2">
                <NumberInput
                  value={portionMultiplier}
                  onValueChange={handlePortionInputChange}
                  className="w-24"
                  disabled={isLoading}
                  aria-invalid={!!portionError}
                  aria-label={tPortion('aria')}
                />
                <Body variant="muted">{tPortion('helper')}</Body>
              </div>
              {portionError && <FieldError>{portionError}</FieldError>}
            </div>

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

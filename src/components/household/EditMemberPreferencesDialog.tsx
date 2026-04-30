'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
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
}

export function EditMemberPreferencesDialog({
  member,
  open,
  onOpenChange,
  onSaved,
  isManualMember,
}: EditMemberPreferencesDialogProps) {
  const t = useTranslations('household.editMember')
  const tPortion = useTranslations('household.portion')

  // Member name (only for manual members)
  const [name, setName] = useState('')

  // Preferences state
  const [displayName, setDisplayName] = useState('')
  const [portionMultiplier, setPortionMultiplier] = useState(1.0)
  const [portionError, setPortionError] = useState<string | null>(null)

  // Form state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Reset form when member changes
  useEffect(() => {
    if (member) {
      setName(member.name || '')
      setDisplayName(member.preferences?.displayName || '')
      setPortionMultiplier(member.preferences?.portionMultiplier || 1.0)
      setError('')
      setPortionError(null)
    }
  }, [member])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!member) return

    setError('')

    if (portionMultiplier < 0.5 || portionMultiplier > 3.0) {
      setPortionError(tPortion('invalid'))
      return
    }

    setIsLoading(true)

    try {
      const payload: Record<string, unknown> = {
        preferences: {
          displayName: displayName || null,
          portionMultiplier,
        },
      }

      // Only include name for manual members
      const trimmedName = name.trim()
      if (isManualMember && trimmedName) {
        payload.name = trimmedName
      }

      const response = await fetch(`/api/households/me/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || t('errors.saveFailed'))
      }

      const updatedMember = await response.json()
      onSaved(updatedMember)
      onOpenChange(false)
      toast.success(t('savedToast'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.saveFailed'))
    } finally {
      setIsLoading(false)
    }
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
      <DialogContent className="sm:max-w-lg">
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
              <Label htmlFor="displayName">{t('displayNameLabel')}</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                placeholder={t('displayNamePlaceholder')}
                disabled={isLoading}
              />
              <Body variant="muted" className="text-sm">
                {t('displayNameHelper')}
              </Body>
            </div>

            {/* Portion size */}
            <div className="flex flex-col gap-2">
              <Label>{tPortion('size')}</Label>
              <div className="flex flex-wrap gap-2">
                {PORTION_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant={portionMultiplier === preset.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPortionMultiplier(preset.value)}
                    disabled={isLoading}
                  >
                    {tPortion('preset', { label: tPortion(preset.key), multiplier: preset.value })}
                  </Button>
                ))}
              </div>
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
              {portionError && (
                <Body variant="small" className="text-destructive">
                  {portionError}
                </Body>
              )}
            </div>

            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}
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

'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Member } from '@/types/member'

const PORTION_PRESETS: Array<{ key: 'small' | 'regular' | 'large' | 'extraLarge'; value: number }> =
  [
    { key: 'small', value: 0.75 },
    { key: 'regular', value: 1.0 },
    { key: 'large', value: 1.5 },
    { key: 'extraLarge', value: 2.0 },
  ]

interface AddMemberDialogProps {
  onMemberAdded: (member: Member) => void
}

export function AddMemberDialog({ onMemberAdded }: AddMemberDialogProps) {
  const t = useTranslations('household.addMember')
  const tPortion = useTranslations('household.portion')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [portionMultiplier, setPortionMultiplier] = useState(1.0)
  const [portionError, setPortionError] = useState<string | null>(null)
  const [error, setError] = useState('')

  const addMember = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim()
      const response = await fetch('/api/households/me/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          preferences: {
            displayName: displayName.trim() || null,
            portionMultiplier,
          },
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || t('errors.addFailed'))
      }

      return response.json()
    },
    onSuccess: (newMember) => {
      onMemberAdded(newMember)
      handleOpenChange(false)
      toast.success(t('addedToast'))
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('errors.addFailed'))
    },
  })

  const isLoading = addMember.isPending

  const resetForm = () => {
    setName('')
    setDisplayName('')
    setPortionMultiplier(1.0)
    setPortionError(null)
    setError('')
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      resetForm()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t('errors.nameRequired'))
      return
    }

    if (portionMultiplier < 0.5 || portionMultiplier > 3.0) {
      setPortionError(tPortion('invalid'))
      return
    }

    addMember.mutate()
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-4">
            {/* Name (required) */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-member-name">{t('nameLabel')}</Label>
              <Input
                id="add-member-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder={t('namePlaceholder')}
                disabled={isLoading}
                required
              />
            </div>

            {/* Display name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-member-displayName">{t('displayNameLabel')}</Label>
              <Input
                id="add-member-displayName"
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
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
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

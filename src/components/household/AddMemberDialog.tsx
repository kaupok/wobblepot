'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { ApiError, apiFetch } from '@/lib/api'
import { FieldError } from '@/components/FieldError'
import { PortionSizeField, isValidPortion } from './PortionSizeField'

interface AddMemberDialogProps {
  onMemberAdded: (member: Member) => void
}

export function AddMemberDialog({ onMemberAdded }: AddMemberDialogProps) {
  const t = useTranslations('household.addMember')
  const tPortion = useTranslations('household.portion')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [portionMultiplier, setPortionMultiplier] = useState<number | null>(1.0)
  const [portionError, setPortionError] = useState<string | null>(null)
  const [error, setError] = useState('')

  const addMember = useMutation({
    mutationFn: (portionMultiplier: number) =>
      apiFetch<Member>(
        '/api/households/me/members',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            // A member without an account has one name (HON-1021).
            preferences: {
              displayName: null,
              portionMultiplier,
            },
          }),
        },
        t('errors.addFailed'),
      ),
    onSuccess: (newMember) => {
      onMemberAdded(newMember)
      handleOpenChange(false)
      toast.success(t('addedToast'))
    },
    onError: (err) => {
      // The route's `error` strings are English, so the server text is logged,
      // never rendered. A full household is the one failure with its own copy:
      // retrying cannot fix it, so the generic "failed" line would mislead
      // (HON-720).
      console.error(
        '[add-member] add failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      if (err instanceof ApiError && err.code === 'household_full') {
        const { limit } = err.body as { limit?: unknown }
        setError(
          typeof limit === 'number'
            ? t('errors.householdFull', { limit })
            : t('errors.householdFullNoLimit'),
        )
        return
      }
      setError(t('errors.addFailed'))
    },
  })

  const isLoading = addMember.isPending

  const resetForm = () => {
    setName('')
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

    if (!isValidPortion(portionMultiplier)) {
      setPortionError(tPortion('invalid'))
      return
    }

    addMember.mutate(portionMultiplier)
  }

  const handlePortionChange = (value: number | null) => {
    setPortionMultiplier(value)
    // An empty input is not flagged while typing; submit catches it.
    setPortionError(value === null || isValidPortion(value) ? null : tPortion('invalid'))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {/* Label-sized: it sits on the Members title row (HON-960), which
            replaced the flex-column host that stretched it on a phone (HON-782). */}
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

            <PortionSizeField
              labelId="add-member-portion-label"
              value={portionMultiplier}
              onValueChange={handlePortionChange}
              disabled={isLoading}
              error={portionError}
            />

            {error && <FieldError>{error}</FieldError>}
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

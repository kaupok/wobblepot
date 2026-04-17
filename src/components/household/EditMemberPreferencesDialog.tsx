'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
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

const PORTION_PRESETS = [
  { label: 'Small', value: 0.75 },
  { label: 'Regular', value: 1.0 },
  { label: 'Large', value: 1.5 },
  { label: 'Extra large', value: 2.0 },
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
        throw new Error(errorData.error || 'Failed to save preferences')
      }

      const updatedMember = await response.json()
      onSaved(updatedMember)
      onOpenChange(false)
      toast.success('Preferences saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePortionInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    if (isNaN(value)) {
      setPortionError(null)
      return
    }
    if (value < 0.5 || value > 3.0) {
      setPortionError('Portion size must be between 0.5 and 3.0')
      return
    }
    setPortionError(null)
    setPortionMultiplier(Math.round(value * 100) / 100)
  }

  const memberDisplayName =
    member?.preferences?.displayName || member?.user?.name || member?.name || 'member'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit preferences for {memberDisplayName}</DialogTitle>
            <DialogDescription>Update portion size for this member.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-4">
            {/* Member name (only for manual members) */}
            {isManualMember && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="Enter name"
                  disabled={isLoading}
                />
              </div>
            )}

            {/* Display name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                placeholder="e.g., Mom, Dad, Alex"
                disabled={isLoading}
              />
              <Body variant="muted" className="text-sm">
                How this member appears in the household
              </Body>
            </div>

            {/* Portion size */}
            <div className="flex flex-col gap-2">
              <Label>Portion size</Label>
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
                    {preset.label} ({preset.value}x)
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.5}
                  max={3.0}
                  step={0.05}
                  value={portionMultiplier}
                  onChange={handlePortionInputChange}
                  className="w-24"
                  disabled={isLoading}
                  aria-invalid={!!portionError}
                  aria-label="Portion multiplier"
                />
                <Body variant="muted">x standard portion</Body>
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
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save preferences'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

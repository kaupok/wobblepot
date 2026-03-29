'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Member } from '@/types/member'

const PORTION_PRESETS = [
  { label: 'Small', value: 0.75 },
  { label: 'Regular', value: 1.0 },
  { label: 'Large', value: 1.5 },
  { label: 'Extra large', value: 2.0 },
]

interface AddMemberDialogProps {
  onMemberAdded: (member: Member) => void
}

export function AddMemberDialog({ onMemberAdded }: AddMemberDialogProps) {
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
        throw new Error(errorData.error || 'Failed to add member')
      }

      return response.json()
    },
    onSuccess: (newMember) => {
      onMemberAdded(newMember)
      handleOpenChange(false)
      toast.success('Member added')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'An error occurred')
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
      setError('Name is required')
      return
    }

    addMember.mutate()
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add household member</DialogTitle>
            <DialogDescription>
              Add a family member who doesn&apos;t have an account, such as a child.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6 py-4">
            {/* Name (required) */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-member-name">Name</Label>
              <Input
                id="add-member-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="Enter name"
                disabled={isLoading}
                required
              />
            </div>

            {/* Display name */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="add-member-displayName">Display name (optional)</Label>
              <Input
                id="add-member-displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                placeholder="e.g., kiddo, little one"
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
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Adding...' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

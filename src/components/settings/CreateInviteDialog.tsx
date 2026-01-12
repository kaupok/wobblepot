'use client'

import { useState } from 'react'
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
import type { Invite } from '@/types/invite'

interface CreateInviteDialogProps {
  onInviteCreated: (invite: Invite) => void
}

export function CreateInviteDialog({ onInviteCreated }: CreateInviteDialogProps) {
  const [open, setOpen] = useState(false)
  const [expiresInDays, setExpiresInDays] = useState('7')
  const [maxUses, setMaxUses] = useState('5')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdInvite, setCreatedInvite] = useState<Invite | null>(null)
  const [copied, setCopied] = useState(false)

  const resetForm = () => {
    setExpiresInDays('7')
    setMaxUses('5')
    setError('')
    setCreatedInvite(null)
    setCopied(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      resetForm()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/households/me/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresInDays: parseInt(expiresInDays, 10),
          maxUses: parseInt(maxUses, 10),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create invite')
      }

      const invite = await response.json()
      const newInvite: Invite = {
        ...invite,
        isActive: true,
      }
      setCreatedInvite(newInvite)
      onInviteCreated(newInvite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!createdInvite) return
    try {
      await navigator.clipboard.writeText(createdInvite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Failed to copy to clipboard')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>Create invite</Button>
      </DialogTrigger>
      <DialogContent>
        {createdInvite ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite created</DialogTitle>
              <DialogDescription>
                Share this link with family members to invite them to your household.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>Invite link</Label>
                <div className="flex gap-2">
                  <Input value={createdInvite.url} readOnly className="font-mono text-sm" />
                  <Button variant="outline" onClick={handleCopy} className="shrink-0">
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
              </div>
              <Body variant="muted">
                This invite can be used {createdInvite.maxUses} times and expires in {expiresInDays}{' '}
                days.
              </Body>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Create invite link</DialogTitle>
              <DialogDescription>
                Create a shareable link to invite family members to your household.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="expiresInDays">Expires in (days)</Label>
                <Input
                  id="expiresInDays"
                  type="number"
                  min="1"
                  max="30"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="maxUses">Maximum uses</Label>
                <Input
                  id="maxUses"
                  type="number"
                  min="1"
                  max="100"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  disabled={isLoading}
                />
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
                {isLoading ? 'Creating...' : 'Create invite'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

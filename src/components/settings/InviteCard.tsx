'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { Invite } from '@/types/invite'

interface InviteCardProps {
  invite: Invite
  onRevoke: (id: string) => void
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays)
    if (absDays === 1) return 'Expired yesterday'
    return `Expired ${absDays} days ago`
  }
  if (diffDays === 0) return 'Expires today'
  if (diffDays === 1) return 'Expires tomorrow'
  return `Expires in ${diffDays} days`
}

export function InviteCard({ invite, onRevoke }: InviteCardProps) {
  const [copied, setCopied] = useState(false)
  const [isRevoking, setIsRevoking] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silently fail - user can manually copy
    }
  }

  const handleRevoke = async () => {
    if (!confirm('Are you sure you want to revoke this invite? This action cannot be undone.')) {
      return
    }

    setIsRevoking(true)
    try {
      const response = await fetch(`/api/households/me/invites/${invite.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to revoke invite')
      }

      onRevoke(invite.id)
    } catch {
      alert('Failed to revoke invite. Please try again.')
    } finally {
      setIsRevoking(false)
    }
  }

  const usageText =
    invite.maxUses === null
      ? `${invite.usesCount} uses`
      : `${invite.usesCount}/${invite.maxUses} uses`

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        !invite.isActive && 'bg-muted/50 opacity-75',
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant={invite.isActive ? 'default' : 'secondary'}>
            {invite.isActive ? 'Active' : 'Expired'}
          </Badge>
          <Body variant="muted">{usageText}</Body>
        </div>

        <div className="flex gap-2">
          <Input value={invite.url} readOnly className="font-mono text-sm" />
          {invite.isActive && (
            <Button variant="outline" onClick={handleCopy} className="shrink-0">
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Body variant="muted">{formatRelativeTime(invite.expiresAt)}</Body>
          {invite.isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRevoke}
              disabled={isRevoking}
              className="text-destructive hover:text-destructive"
            >
              {isRevoking ? 'Revoking...' : 'Revoke'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

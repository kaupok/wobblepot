'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { SettingsNav } from '@/components/settings-nav'
import { CreateInviteDialog } from './CreateInviteDialog'
import { InviteCard } from './InviteCard'
import type { Invite } from '@/types/invite'

interface InviteListProps {
  isOwner: boolean
}

export function InviteList({ isOwner }: InviteListProps) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [expiredOpen, setExpiredOpen] = useState(false)

  useEffect(() => {
    async function fetchInvites() {
      try {
        const response = await fetch('/api/households/me/invites')
        if (!response.ok) {
          if (response.status === 403) {
            // Non-owner - no permission, but this is expected
            setInvites([])
            return
          }
          throw new Error('Failed to fetch invites')
        }
        const data = await response.json()
        setInvites(data.invites)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoading(false)
      }
    }

    if (isOwner) {
      fetchInvites()
    } else {
      setIsLoading(false)
    }
  }, [isOwner])

  const handleInviteCreated = (invite: Invite) => {
    setInvites((prev) => [invite, ...prev])
  }

  const handleInviteRevoked = (id: string) => {
    setInvites((prev) => prev.filter((invite) => invite.id !== id))
  }

  const activeInvites = invites.filter((invite) => invite.isActive)
  const expiredInvites = invites.filter((invite) => !invite.isActive)

  if (!isOwner) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Invite management</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Manage invite links for your household</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8">
            <SettingsNav />
            <Body variant="muted">
              Only the household owner can manage invites.
            </Body>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>
          <Heading variant="h2">Invite management</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">
            Create and manage invite links for family members to join your household
          </Body>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-8">
          <SettingsNav />

          <div className="flex items-center justify-between">
            <Heading variant="h4">Invite links</Heading>
            <CreateInviteDialog onInviteCreated={handleInviteCreated} />
          </div>

          {isLoading ? (
            <Body variant="muted">Loading invites...</Body>
          ) : error ? (
            <Body variant="small" className="text-destructive">
              {error}
            </Body>
          ) : invites.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Body variant="muted">
                No invites yet. Create an invite link to share with family members.
              </Body>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {activeInvites.length > 0 && (
                <div className="flex flex-col gap-3">
                  <Body variant="small" className="text-muted-foreground">
                    Active invites
                  </Body>
                  {activeInvites.map((invite) => (
                    <InviteCard
                      key={invite.id}
                      invite={invite}
                      onRevoke={handleInviteRevoked}
                    />
                  ))}
                </div>
              )}

              {expiredInvites.length > 0 && (
                <Collapsible open={expiredOpen} onOpenChange={setExpiredOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-start gap-2 px-0">
                      <span className="text-sm text-muted-foreground">
                        {expiredOpen ? '▼' : '▶'} Expired invites ({expiredInvites.length})
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-col gap-3 pt-2">
                      {expiredInvites.map((invite) => (
                        <InviteCard
                          key={invite.id}
                          invite={invite}
                          onRevoke={handleInviteRevoked}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

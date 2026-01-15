'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { HouseholdNav } from '@/components/household-nav'
import { MemberCard } from './MemberCard'
import { EditMemberPreferencesDialog } from './EditMemberPreferencesDialog'
import type { Member, DietaryType } from '@/types/member'

interface MemberListProps {
  isOwner: boolean
  currentMemberId: string
  householdDietaryType: DietaryType | null
}

function MemberCardSkeleton() {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    </div>
  )
}

export function MemberList({ isOwner, currentMemberId, householdDietaryType }: MemberListProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingMember, setEditingMember] = useState<Member | null>(null)

  useEffect(() => {
    async function fetchMembers() {
      try {
        const response = await fetch('/api/households/me/members')
        if (!response.ok) {
          throw new Error('Failed to fetch members')
        }
        const data = await response.json()
        setMembers(data.members)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoading(false)
      }
    }

    fetchMembers()
  }, [])

  const handleMemberSaved = (updatedMember: Member) => {
    setMembers((prev) => prev.map((m) => (m.id === updatedMember.id ? updatedMember : m)))
  }

  const canEditMember = (member: Member) => {
    // Owner can edit anyone, members can only edit themselves
    return isOwner || member.id === currentMemberId
  }

  return (
    <>
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Household members</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">View and manage preferences for all household members</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-8">
            <HouseholdNav />

            {isLoading ? (
              <div className="flex flex-col gap-3">
                <MemberCardSkeleton />
                <MemberCardSkeleton />
              </div>
            ) : error ? (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            ) : members.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Body variant="muted">No members found.</Body>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    canEdit={canEditMember(member)}
                    onEdit={setEditingMember}
                  />
                ))}
              </div>
            )}

            {!isOwner && (
              <Body variant="muted" className="text-sm">
                You can only edit your own preferences. Contact the household owner to update other
                members.
              </Body>
            )}
          </div>
        </CardContent>
      </Card>

      <EditMemberPreferencesDialog
        member={editingMember}
        open={editingMember !== null}
        onOpenChange={(open) => !open && setEditingMember(null)}
        onSaved={handleMemberSaved}
        householdDietaryType={householdDietaryType}
        isManualMember={editingMember?.userId === null}
      />
    </>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { Heading, Body } from '@/components/ui/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { MemberCard } from './MemberCard'
import { AddMemberDialog } from './AddMemberDialog'
import { EditMemberPreferencesDialog } from './EditMemberPreferencesDialog'
import { MemberInviteDialog } from './MemberInviteDialog'
import type { Member, MemberInvite } from '@/types/member'

interface MemberListProps {
  isOwner: boolean
  currentMemberId: string
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

export function MemberList({ isOwner, currentMemberId }: MemberListProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [invitingMember, setInvitingMember] = useState<Member | null>(null)

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

  const handleMemberAdded = (newMember: Member) => {
    setMembers((prev) => [...prev, newMember])
  }

  const handleMemberSaved = (updatedMember: Member) => {
    setMembers((prev) => prev.map((m) => (m.id === updatedMember.id ? updatedMember : m)))
  }

  const handleMemberRemoved = (memberId: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== memberId))
  }

  const canEditMember = (member: Member) => {
    // Owner can edit anyone, members can only edit themselves
    return isOwner || member.id === currentMemberId
  }

  const canRemoveMember = (member: Member) => {
    // Only owner can remove members, and cannot remove themselves or the owner
    return isOwner && member.role !== 'owner' && member.id !== currentMemberId
  }

  const canInviteMember = (member: Member) => {
    // Only owner can invite, and only for manual members (no linked user account)
    return isOwner && member.userId === null
  }

  const handleInviteCreated = (memberId: string, invite: MemberInvite) => {
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, invite } : m)))
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Heading variant="h2">Members</Heading>
          <Body variant="muted">Manage household members and their portion sizes</Body>
        </div>

        <div className="flex flex-col gap-6">
          {isOwner && <AddMemberDialog onMemberAdded={handleMemberAdded} />}

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
                  canRemove={canRemoveMember(member)}
                  canInvite={canInviteMember(member)}
                  onEdit={setEditingMember}
                  onRemove={handleMemberRemoved}
                  onInvite={setInvitingMember}
                  onInviteUpdated={handleInviteCreated}
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
      </div>

      <EditMemberPreferencesDialog
        member={editingMember}
        open={editingMember !== null}
        onOpenChange={(open) => !open && setEditingMember(null)}
        onSaved={handleMemberSaved}
        isManualMember={editingMember?.userId === null}
      />

      {invitingMember && (
        <MemberInviteDialog
          open={invitingMember !== null}
          onOpenChange={(open) => !open && setInvitingMember(null)}
          memberId={invitingMember.id}
          memberName={
            invitingMember.preferences?.displayName || invitingMember.name || 'this member'
          }
          existingInvite={invitingMember.invite}
          onInviteCreated={(invite) => handleInviteCreated(invitingMember.id, invite)}
        />
      )}
    </>
  )
}

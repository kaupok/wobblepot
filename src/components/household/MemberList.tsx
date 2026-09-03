'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Heading, Body } from '@/components/ui/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { apiFetch } from '@/lib/api'
import { MemberCard } from './MemberCard'
import { AddMemberDialog } from './AddMemberDialog'
import { EditMemberPreferencesDialog } from './EditMemberPreferencesDialog'
import { MemberInviteDialog } from './MemberInviteDialog'
import type { Member } from '@/types/member'

const MEMBERS_QUERY_KEY = ['household-members']

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
  const t = useTranslations('household.members')
  const queryClient = useQueryClient()
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [invitingMember, setInvitingMember] = useState<Member | null>(null)

  const {
    data: members = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: () => apiFetch<{ members: Member[] }>('/api/households/me/members'),
    select: (data) => data.members,
  })

  // The add / edit / remove / invite dialogs each own their mutation; the
  // roster refetches from the server rather than being patched in two places.
  const refreshMembers = () => {
    void queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY })
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

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Heading variant="h4" as="h2">
            {t('heading')}
          </Heading>
          <Body variant="muted">{t('description')}</Body>
        </div>

        <div className="flex flex-col gap-6">
          {isOwner && <AddMemberDialog onMemberAdded={refreshMembers} />}

          {isLoading ? (
            <div className="flex flex-col gap-3">
              <MemberCardSkeleton />
              <MemberCardSkeleton />
            </div>
          ) : error ? (
            <Body variant="small" className="text-destructive">
              {t('loadFailed')}
            </Body>
          ) : members.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Body variant="muted">{t('empty')}</Body>
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
                  onRemove={refreshMembers}
                  onInvite={setInvitingMember}
                  onInviteUpdated={refreshMembers}
                />
              ))}
            </div>
          )}

          {!isOwner && (
            <Body variant="muted" className="text-sm">
              {t('nonOwnerNotice')}
            </Body>
          )}
        </div>
      </div>

      <EditMemberPreferencesDialog
        member={editingMember}
        open={editingMember !== null}
        onOpenChange={(open) => !open && setEditingMember(null)}
        onSaved={refreshMembers}
        isManualMember={editingMember?.userId === null}
      />

      {invitingMember && (
        <MemberInviteDialog
          open={invitingMember !== null}
          onOpenChange={(open) => !open && setInvitingMember(null)}
          memberId={invitingMember.id}
          memberName={
            invitingMember.preferences?.displayName ||
            invitingMember.name ||
            t('fallbackInviteName')
          }
          existingInvite={invitingMember.invite}
          onInviteCreated={refreshMembers}
        />
      )}
    </>
  )
}

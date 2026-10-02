'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Heading, Body } from '@/components/ui/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { apiFetch } from '@/lib/api'
import { MemberRow } from './MemberRow'
import { AddMemberDialog } from './AddMemberDialog'
import { EditMemberPreferencesDialog } from './EditMemberPreferencesDialog'
import { MemberInviteDialog } from './MemberInviteDialog'
import type { Member } from '@/types/member'
import { FieldError } from '@/components/FieldError'
import { MEMBERS_QUERY_KEY, type MembersResponse } from './members-query'

interface MemberListProps {
  isOwner: boolean
  currentMemberId: string
}

/** A `MemberRow`'s height: `min-h-11`, a name line and the portion at the end. */
function MemberRowSkeleton() {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1.5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-5 w-20" />
    </div>
  )
}

export function MemberList({ isOwner, currentMemberId }: MemberListProps) {
  const t = useTranslations('household.members')
  const queryClient = useQueryClient()
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [invitingMember, setInvitingMember] = useState<Member | null>(null)
  // Both dialogs open from state, with no `DialogTrigger` to hand focus back
  // to, so each row says which of its controls opened them: the name for the
  // edit dialog, the ⋯ trigger for the invite dialog.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  // A removed member's row unmounts with the control that opened its confirm
  // dialog, so focus goes to the list's heading instead.
  const headingRef = useRef<HTMLElement>(null)

  function returnFocusOnClose(event: Event) {
    event.preventDefault()
    returnFocusRef.current?.focus()
  }

  const {
    data: members = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: () => apiFetch<MembersResponse>('/api/households/me/members'),
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
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Heading ref={headingRef} tabIndex={-1} variant="section" as="h2">
            {t('heading')}
          </Heading>
          {isOwner && <AddMemberDialog onMemberAdded={refreshMembers} />}
        </div>

        {isLoading ? (
          <div className="flex flex-col divide-y">
            <MemberRowSkeleton />
            <MemberRowSkeleton />
          </div>
        ) : error ? (
          <FieldError>{t('loadFailed')}</FieldError>
        ) : members.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Body variant="muted">{t('empty')}</Body>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                canEdit={canEditMember(member)}
                canRemove={canRemoveMember(member)}
                canInvite={canInviteMember(member)}
                onEdit={(m, returnFocusTo) => {
                  returnFocusRef.current = returnFocusTo
                  setEditingMember(m)
                }}
                onRemove={refreshMembers}
                onRemoveFocus={() => headingRef.current?.focus()}
                onInvite={(m, returnFocusTo) => {
                  returnFocusRef.current = returnFocusTo
                  setInvitingMember(m)
                }}
                onInviteUpdated={refreshMembers}
              />
            ))}
          </ul>
        )}
      </section>

      <EditMemberPreferencesDialog
        member={editingMember}
        open={editingMember !== null}
        onOpenChange={(open) => !open && setEditingMember(null)}
        onSaved={refreshMembers}
        isManualMember={editingMember?.userId === null}
        onCloseAutoFocus={returnFocusOnClose}
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
          onCloseAutoFocus={returnFocusOnClose}
        />
      )}
    </>
  )
}

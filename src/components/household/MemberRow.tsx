'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Mail, MoreHorizontal, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Body } from '@/components/ui/typography'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { ApiError, apiFetch } from '@/lib/api'
import type { Member, MemberInvite } from '@/types/member'

const PORTION_PRESET_KEYS: Record<number, 'small' | 'regular' | 'large' | 'extraLarge'> = {
  0.75: 'small',
  1: 'regular',
  1.5: 'large',
  2: 'extraLarge',
}

interface MemberRowProps {
  member: Member
  canEdit: boolean
  canRemove: boolean
  canInvite: boolean
  /** `returnFocusTo` is the control to focus once the edit dialog closes. */
  onEdit: (member: Member, returnFocusTo: HTMLElement | null) => void
  onRemove: (memberId: string) => void
  /** `returnFocusTo` is the control to focus once the invite dialog closes. */
  onInvite: (member: Member, returnFocusTo: HTMLElement | null) => void
  onInviteUpdated: (memberId: string, invite: MemberInvite) => void
}

/**
 * One member as one unbordered row of a `divide-y` list: name, badges, the
 * portion in short form, and a ⋯ menu for invite and remove (HON-960).
 */
export function MemberRow({
  member,
  canEdit,
  canRemove,
  canInvite,
  onEdit,
  onRemove,
  onInvite,
}: MemberRowProps) {
  const tMembers = useTranslations('household.members')
  const tPortion = useTranslations('household.portion')
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const moreActionsTriggerRef = useRef<HTMLButtonElement>(null)

  const displayName =
    member.preferences?.displayName || member.user?.name || member.name || tMembers('unknownName')
  const isManual = member.userId === null
  const isOwner = member.role === 'owner'
  const hasActiveInvite = member.invite?.isActive === true
  const ownerLabel = useEnumLabel('HouseholdRole', 'owner')
  const portionMultiplier = member.preferences?.portionMultiplier ?? 1.0
  const presetKey = PORTION_PRESET_KEYS[portionMultiplier]
  const portionLabel = presetKey
    ? tPortion('short', { label: tPortion(presetKey), multiplier: portionMultiplier })
    : tPortion('shortCustom', { multiplier: portionMultiplier })
  const hasMenu = canInvite || canRemove

  const removeMember = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/households/me/members/${member.id}`,
        { method: 'DELETE' },
        tMembers('removeFailed'),
      ),
    onSuccess: () => {
      setShowRemoveDialog(false)
      onRemove(member.id)
      toast.success(tMembers('removed'))
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      // 403 is the owner-only check; 400 is removing yourself or the owner.
      console.error(
        '[member-row] remove failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      const status = err instanceof ApiError ? err.status : undefined
      toast.error(
        status === 403
          ? tMembers('removeOwnerOnly')
          : status === 400
            ? tMembers('removeNotAllowed')
            : tMembers('removeFailed'),
      )
    },
  })

  // The confirm dialog opens from a menu item that is gone by the time it
  // closes, so it hands focus back to the menu trigger instead of the body.
  function focusMoreActionsOnClose(event: Event) {
    event.preventDefault()
    moreActionsTriggerRef.current?.focus()
  }

  return (
    <li className="relative flex min-h-11 items-center gap-3 py-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <Body>
          {canEdit ? (
            // The name is the edit control, and its `::after` stretches over
            // the whole row so the row is the target; the menu slot below is
            // positioned too and later in the DOM, so it paints above it. A
            // native button rather than `Button`: the name wraps, and every
            // `Button` size is a fixed height (as MealCard's name button).
            <button
              type="button"
              className="focus-visible:after:outline-foreground cursor-pointer text-left underline-offset-2 outline-none after:absolute after:inset-0 after:rounded-md hover:underline focus-visible:after:outline-2 focus-visible:after:outline-offset-2"
              onClick={(event) => onEdit(member, event.currentTarget)}
            >
              {displayName}
            </button>
          ) : (
            displayName
          )}
        </Body>
        {isOwner && <Badge variant="secondary">{ownerLabel}</Badge>}
        {hasActiveInvite && <Badge variant="secondary">{tMembers('invitePendingBadge')}</Badge>}
        {isManual && !hasActiveInvite && <Badge variant="outline">{tMembers('manualBadge')}</Badge>}
      </div>

      <div className="shrink-0">
        <Body variant="muted">{portionLabel}</Body>
      </div>

      {/* Held at the trigger's size on every row, so the portions line up
          whether or not this row has a menu. */}
      <div className="relative size-8 shrink-0">
        {hasMenu && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={moreActionsTriggerRef}
                variant="ghost"
                size="icon-sm"
                aria-label={tMembers('moreActions', { name: displayName })}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canInvite && (
                <DropdownMenuItem onSelect={() => onInvite(member, moreActionsTriggerRef.current)}>
                  <Mail aria-hidden="true" />
                  {tMembers('inviteAction')}
                </DropdownMenuItem>
              )}
              {canRemove && (
                <DropdownMenuItem variant="destructive" onSelect={() => setShowRemoveDialog(true)}>
                  <Trash2 aria-hidden="true" />
                  {tMembers('removeAction')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <ConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        title={tMembers('removeDialog.title')}
        description={tMembers('removeDialog.description', { name: displayName })}
        confirmLabel={tMembers('removeDialog.confirm')}
        variant="destructive"
        onConfirm={() => removeMember.mutate()}
        isLoading={removeMember.isPending}
        onCloseAutoFocus={focusMoreActionsOnClose}
      />
    </li>
  )
}

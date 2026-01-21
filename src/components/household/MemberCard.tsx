'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Body } from '@/components/ui/typography'
import { Pencil, Trash2, User, Crown, Mail } from 'lucide-react'
import { getEffectiveCalories, getEffectiveProtein } from '@/lib/nutrition-defaults'
import type { Member, DietaryType, MemberInvite } from '@/types/member'

const ALLERGEN_LABELS: Record<string, string> = {
  gluten: 'Gluten',
  dairy: 'Dairy',
  eggs: 'Eggs',
  nuts: 'Tree nuts',
  peanuts: 'Peanuts',
  soy: 'Soy',
  fish: 'Fish',
  shellfish: 'Shellfish',
  sesame: 'Sesame',
}

const DIETARY_TYPE_LABELS: Record<DietaryType, string> = {
  omnivore: 'Omnivore',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
}

interface MemberCardProps {
  member: Member
  canEdit: boolean
  canRemove: boolean
  canInvite: boolean
  onEdit: (member: Member) => void
  onRemove: (memberId: string) => void
  onInvite: (member: Member) => void
  onInviteUpdated: (memberId: string, invite: MemberInvite) => void
}

export function MemberCard({
  member,
  canEdit,
  canRemove,
  canInvite,
  onEdit,
  onRemove,
  onInvite,
}: MemberCardProps) {
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const displayName =
    member.preferences?.displayName || member.user?.name || member.name || 'Unknown member'
  const isManual = member.userId === null
  const isOwner = member.role === 'owner'

  // Get effective nutrition values with default indicators
  const calories = getEffectiveCalories(member.preferences)
  const protein = getEffectiveProtein(member.preferences)
  const portionMultiplier = member.preferences?.portionMultiplier ?? 1.0
  const usesDefaults = calories.isDefault || protein.isDefault

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      const response = await fetch(`/api/households/me/members/${member.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to remove member')
      }

      setShowRemoveDialog(false)
      onRemove(member.id)
      toast.success('Member removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setIsRemoving(false)
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
              {isOwner ? (
                <Crown className="text-primary h-5 w-5" aria-hidden="true" />
              ) : (
                <User className="text-muted-foreground h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <Body className="font-medium">{displayName}</Body>
                {isOwner && (
                  <Badge variant="secondary" className="text-xs">
                    Owner
                  </Badge>
                )}
                {isManual && !member.invite?.isActive && (
                  <Badge variant="outline" className="text-xs">
                    Manual
                  </Badge>
                )}
                {member.invite?.isActive && (
                  <Badge variant="secondary" className="text-xs">
                    Invite pending
                  </Badge>
                )}
              </div>
              {member.user?.email && (
                <Body variant="muted" className="text-sm">
                  {member.user.email}
                </Body>
              )}
              {/* Nutrition targets summary */}
              <Body variant="muted" className="text-sm">
                {portionMultiplier}x · {calories.value.toLocaleString()} kcal · {protein.value}g
                protein
                {usesDefaults && ' (default)'}
              </Body>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canInvite && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onInvite(member)}
                aria-label="Invite to join"
              >
                <Mail className="h-4 w-4" />
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(member)}
                aria-label="Edit preferences"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canRemove && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowRemoveDialog(true)}
                aria-label="Remove member"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Dietary badges */}
        {member.preferences && (
          <div className="flex flex-wrap gap-2">
            {member.preferences.dietaryType && (
              <Badge variant="secondary">
                {DIETARY_TYPE_LABELS[member.preferences.dietaryType]}
              </Badge>
            )}
            {member.preferences.allergens.map((allergen) => (
              <Badge key={allergen} variant="destructive" className="text-xs">
                {ALLERGEN_LABELS[allergen] || allergen}
              </Badge>
            ))}
            {member.preferences.restrictions.map((restriction) => (
              <Badge key={restriction} variant="outline" className="text-xs">
                {restriction}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        title="Remove member"
        description={`Are you sure you want to remove ${displayName} from the household? This action cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleRemove}
        isLoading={isRemoving}
      />
    </div>
  )
}

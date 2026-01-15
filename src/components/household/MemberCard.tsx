'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { Pencil, User, Crown } from 'lucide-react'
import type { Member, DietaryType } from '@/types/member'

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
  onEdit: (member: Member) => void
}

export function MemberCard({ member, canEdit, onEdit }: MemberCardProps) {
  const displayName =
    member.preferences?.displayName || member.user?.name || member.name || 'Unknown member'
  const isManual = member.userId === null
  const isOwner = member.role === 'owner'

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
                {isManual && (
                  <Badge variant="outline" className="text-xs">
                    Manual
                  </Badge>
                )}
              </div>
              {member.user?.email && (
                <Body variant="muted" className="text-sm">
                  {member.user.email}
                </Body>
              )}
            </div>
          </div>
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
        </div>

        {/* Preferences summary */}
        {member.preferences && (
          <div className="flex flex-wrap gap-2">
            {member.preferences.dietaryType && (
              <Badge variant="secondary">
                {DIETARY_TYPE_LABELS[member.preferences.dietaryType]}
              </Badge>
            )}
            {member.preferences.portionMultiplier !== 1.0 && (
              <Badge variant="outline">{member.preferences.portionMultiplier}x portion</Badge>
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

        {!member.preferences && (
          <Body variant="muted" className="text-sm">
            No preferences set
          </Body>
        )}
      </div>
    </div>
  )
}

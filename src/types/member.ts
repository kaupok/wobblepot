/**
 * What a member carries besides their name. Food rules are household-level
 * (HON-1322); a member's portion size scales the household's servings.
 */
export interface MemberPreferences {
  displayName: string | null
  portionMultiplier: number
}

export interface MemberUser {
  id: string
  name: string | null
  email: string
  image: string | null
}

export interface MemberInvite {
  url: string
  expiresAt: string
  isActive: boolean
}

export interface Member {
  id: string
  userId: string | null
  name: string | null
  role: 'owner' | 'member'
  joinedAt: string
  user: MemberUser | null
  preferences: MemberPreferences | null
  invite: MemberInvite | null
}

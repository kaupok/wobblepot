export interface Invite {
  id: string
  code: string
  url: string
  memberId: string
  memberName: string
  expiresAt: string
  maxUses: number | null
  usesCount: number
  isActive: boolean
  createdAt: string
}

export interface MemberInvite {
  url: string
  expiresAt: string
  isActive: boolean
}

export interface Invite {
  id: string
  code: string
  url: string
  memberId: string
  memberName: string
  expiresAt: string
  isActive: boolean
  createdAt: string
}

export interface MemberInvite {
  url: string
  expiresAt: string
  isActive: boolean
}

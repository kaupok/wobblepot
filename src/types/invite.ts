export interface Invite {
  id: string
  code: string
  url: string
  expiresAt: string
  maxUses: number | null
  usesCount: number
  isActive: boolean
  createdAt: string
}

import type { FastifyRequest } from 'fastify'

export interface CurrentUser {
  id: number
  adminUserId: string | null
  accountType: string
  role: string
  displayName: string
  email: string | null
  phone: string | null
  status: string
}

export interface AuthSession {
  id: number
  userId: number
  user: CurrentUser
}

export type AuthenticatedRequest = FastifyRequest & {
  currentUser?: CurrentUser
}

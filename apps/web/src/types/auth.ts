export interface CurrentUser {
  id: number
  admin_user_id: string | null
  account_type: string
  role: string
  display_name: string
  email: string | null
  phone: string | null
  status: string
}

export interface AuthSession {
  id: number
  user_id: number
  user: CurrentUser
}

export interface AdminOAuthTokenSet {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
}

export interface AdminUserProfile {
  id: string
  username?: string | null
  nickname?: string | null
  phone?: string | null
  email?: string | null
  avatar?: string | null
  role?: string | null
  status?: string | null
}

import { randomBytes, scryptSync } from 'node:crypto'

import { Client } from 'pg'

const DEFAULT_DATABASE_URL = 'postgresql://zhaoxiaogang@localhost/xiaochuang?schema=public'

export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'e2e-admin@example.com'
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'E2eAdminPass!123'

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derivedKey}`
}

function buildAdminUserId(email: string) {
  const normalized = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `e2e-admin-${normalized || 'user'}`
}

export async function ensureAdminUser(options?: {
  email?: string
  password?: string
  displayName?: string
  role?: 'admin' | 'super_admin'
}) {
  const email = options?.email || E2E_ADMIN_EMAIL
  const password = options?.password || E2E_ADMIN_PASSWORD
  const displayName = options?.displayName || 'E2E 管理员'
  const role = options?.role || 'admin'
  const adminUserId = buildAdminUserId(email)
  const client = new Client({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  })

  await client.connect()
  try {
    await client.query(
      `
        insert into users (admin_user_id, account_type, role, display_name, email, password_hash, status, created_at, updated_at, deleted_at)
        values ($1, $2, $3, $4, $5, $6, 'active', now(), now(), null)
        on conflict (email)
        do update set
          admin_user_id = excluded.admin_user_id,
          account_type = excluded.account_type,
          role = excluded.role,
          display_name = excluded.display_name,
          password_hash = excluded.password_hash,
          status = 'active',
          deleted_at = null,
          updated_at = now()
      `,
      [adminUserId, 'email', role, displayName, email, hashPassword(password)],
    )
  } finally {
    await client.end()
  }

  return { email, password, displayName, role }
}

import { z } from 'zod'

function isRemoteHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function booleanEnv(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'n', 'off', ''].includes(normalized)) return false
    return value
  }, z.boolean()).default(defaultValue)
}

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://zhaoxiaogang:xiaochuang@localhost:5432/xiaochuang?schema=public'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  CORS_ORIGINS: z.string().default('http://localhost:3001,http://localhost:3002'),
  SESSION_COOKIE_NAME: z.string().default('xiaochuang_session'),
  SESSION_DURATION_DAYS: z.coerce.number().int().positive().default(7),
  AI_CONFIG_ENCRYPTION_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('../data/static'),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: booleanEnv(true),
  STORAGE_OBJECT_ACL: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  DRAMA_AI_FIRST_ENABLED: booleanEnv(true),
  DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK: booleanEnv(false),
})
  // Keep unknown env vars (e.g. VOLC_ARK_API_KEY, VOLC_VOICE, VOLC_RESOURCE_ID)
  // so @nestjs/config writes them back to process.env instead of stripping them.
  .passthrough()

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  const publicBaseUrl = String(env.STORAGE_PUBLIC_BASE_URL || '').trim()
  const aiConfigEncryptionKey = String(env.AI_CONFIG_ENCRYPTION_KEY || '').trim()

  if (env.NODE_ENV === 'production' && env.DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK'],
      message: 'DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK must stay disabled in production',
    })
  }

  if (env.NODE_ENV === 'production' && !aiConfigEncryptionKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AI_CONFIG_ENCRYPTION_KEY'],
      message: 'AI_CONFIG_ENCRYPTION_KEY is required in production',
    })
  }

  if (aiConfigEncryptionKey && aiConfigEncryptionKey.length < 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AI_CONFIG_ENCRYPTION_KEY'],
      message: 'AI_CONFIG_ENCRYPTION_KEY must be at least 16 characters when provided',
    })
  }

  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER !== 's3') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['STORAGE_DRIVER'],
      message: 'production requires STORAGE_DRIVER=s3',
    })
  }

  if (env.STORAGE_DRIVER === 's3') {
    for (const [field, value] of [
      ['S3_ENDPOINT', env.S3_ENDPOINT],
      ['S3_BUCKET', env.S3_BUCKET],
      ['S3_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY],
    ] as const) {
      if (String(value || '').trim()) continue
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is required when STORAGE_DRIVER=s3`,
      })
    }
  }

  if (env.STORAGE_DRIVER === 's3' || env.NODE_ENV === 'production') {
    if (!publicBaseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PUBLIC_BASE_URL'],
        message: 'STORAGE_PUBLIC_BASE_URL is required for s3 or production storage',
      })
      return
    }

    if (!isRemoteHttpUrl(publicBaseUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PUBLIC_BASE_URL'],
        message: 'STORAGE_PUBLIC_BASE_URL must be an http(s) URL for s3 or production storage',
      })
    }
  }
})

export type AppEnv = z.infer<typeof envSchema>

export function loadEnv() {
  return envSchema.parse(process.env)
}

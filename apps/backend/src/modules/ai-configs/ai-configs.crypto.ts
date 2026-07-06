import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

const ENCRYPTED_SECRET_PREFIX = 'enc.v1'
const DEV_FALLBACK_ENCRYPTION_KEY = 'xiaochuang-dev-only-ai-config-key-change-me'

function resolveAiConfigEncryptionKey(explicitKey?: string) {
  const configured = String((explicitKey ?? process.env.AI_CONFIG_ENCRYPTION_KEY) || '').trim()
  if (configured) return configured
  return process.env.NODE_ENV === 'production' ? '' : DEV_FALLBACK_ENCRYPTION_KEY
}

function deriveEncryptionKey(secret: string) {
  return createHash('sha256').update(secret).digest()
}

export function isEncryptedAiConfigSecret(value: string | null | undefined) {
  return String(value || '').trim().startsWith(`${ENCRYPTED_SECRET_PREFIX}:`)
}

export function encryptAiConfigSecret(value: string, explicitKey?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isEncryptedAiConfigSecret(raw)) return raw

  const encryptionKey = resolveAiConfigEncryptionKey(explicitKey)
  if (!encryptionKey) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY is required to encrypt AI service secrets')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(encryptionKey), iv)
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    ENCRYPTED_SECRET_PREFIX,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export function decryptAiConfigSecret(value: string | null | undefined, explicitKey?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (!isEncryptedAiConfigSecret(raw)) return raw

  const encryptionKey = resolveAiConfigEncryptionKey(explicitKey)
  if (!encryptionKey) {
    throw new Error('AI_CONFIG_ENCRYPTION_KEY is required to decrypt AI service secrets')
  }

  const [prefix, ivValue, authTagValue, encryptedValue] = raw.split(':')
  if (prefix !== ENCRYPTED_SECRET_PREFIX || !ivValue || !authTagValue || !encryptedValue) {
    throw new Error('Invalid encrypted AI service secret format')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveEncryptionKey(encryptionKey),
    Buffer.from(ivValue, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ])

  return decrypted.toString('utf8').trim()
}

export function maybeDecryptAiConfigSecret(value: string | null | undefined, explicitKey?: string) {
  try {
    return decryptAiConfigSecret(value, explicitKey)
  } catch {
    return String(value || '').trim()
  }
}

export function prepareAiConfigSecretForStorage(value: string | null | undefined, explicitKey?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return encryptAiConfigSecret(raw, explicitKey)
}

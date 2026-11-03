import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from './config.js'

/**
 * Encrypt-at-rest for organizer API keys. AES-256-GCM with a key derived from
 * the server-only CREDENTIALS_SECRET (never stored in the database).
 * Format: v1:<iv-b64url>:<tag-b64url>:<ciphertext-b64url>
 */
const KEY = createHash('sha256').update(`billsplit-credentials:${config.credentialsSecret}`).digest()

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':')
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('unsupported encrypted-secret format')
  const [, iv, tag, ct] = parts as [string, string, string, string]
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8')
}

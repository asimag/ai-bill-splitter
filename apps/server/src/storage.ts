import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

/**
 * Receipt files are stored outside any public web root, under one directory
 * per organizer, and are only reachable through authorized API streaming.
 */

export interface ImageType {
  ext: string
  mime: string
}

/** Content sniffing — an uploaded file's bytes decide its real type. */
export function detectImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ext: 'png', mime: 'image/png' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { ext: 'jpg', mime: 'image/jpeg' }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return { ext: 'webp', mime: 'image/webp' }
  return null
}

export async function ensureStorageDir(): Promise<void> {
  await mkdir(config.receiptStorageDir, { recursive: true })
}

function resolveKey(key: string): string {
  const full = path.resolve(config.receiptStorageDir, key)
  if (!full.startsWith(path.resolve(config.receiptStorageDir) + path.sep))
    throw new Error('invalid receipt storage key')
  return full
}

export async function saveReceiptBytes(organizerId: string, receiptId: string, bytes: Buffer, ext: string): Promise<string> {
  const key = `${organizerId}/${receiptId}.${ext}`
  const full = resolveKey(key)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, bytes, { mode: 0o640 })
  return key
}

export function readReceiptBytes(key: string): Promise<Buffer> {
  return readFile(resolveKey(key))
}

export function deleteReceiptFile(key: string): Promise<void> {
  return rm(resolveKey(key), { force: true })
}

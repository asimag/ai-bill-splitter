import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { organizerId } from '../auth.js'
import { config } from '../config.js'
import { pool, transaction } from '../db.js'
import { badRequest, handler, HttpError, notFound, requireOwnedTrip, toMinor } from '../http.js'
import { deleteReceiptFile, detectImageType, readReceiptBytes, saveReceiptBytes } from '../storage.js'
import { enqueueExtraction } from '../ai/service.js'
import { receiptRetryLimiter, receiptUploadLimiter } from '../rate-limit.js'

const router = Router()

export function receiptJson(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    tripId: row.trip_id as string,
    status: row.status as string,
    contentType: row.content_type as string,
    sizeBytes: toMinor(row.size_bytes as string),
    originalName: (row.original_name as string | null) ?? null,
    providerUsed: (row.provider_used as string | null) ?? null,
    fallbackReason: (row.fallback_reason as string | null) ?? null,
    errorKind: (row.error_kind as string | null) ?? null,
    processingError: (row.processing_error as string | null) ?? null,
    extraction: (row.extraction as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at,
  }
}

// Memory storage: bytes are content-validated before anything touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.receiptMaxBytes, files: 1 },
})

const uploadSingle = upload.single('image')
function uploadImage(req: Request, res: Response, next: NextFunction): void {
  uploadSingle(req, res, (err) => {
    const code = (err as { code?: string } | undefined)?.code
    if (code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `image exceeds the ${Math.floor(config.receiptMaxBytes / (1024 * 1024))} MB limit`))
    if (err) return next(badRequest('upload failed (expected one image file in field "image")'))
    next()
  })
}

router.post(
  '/trips/:tripId/receipts',
  receiptUploadLimiter.handler,
  uploadImage,
  handler(async (req, res) => {
    const organizer = organizerId(req)
    const file = req.file
    if (!file) throw badRequest('image file is required (field name "image")')
    const type = detectImageType(file.buffer)
    if (!type) throw badRequest('unsupported image content: only JPEG, PNG and WebP are accepted')

    // Ownership first; nothing is written when the trip is not this organizer's.
    await transaction(async (client) => {
      await requireOwnedTrip(client, organizer, req.params.tripId!)
    })

    const receiptId = randomUUID()
    let storageKey: string | null = null
    try {
      storageKey = await saveReceiptBytes(organizer, receiptId, file.buffer, type.ext)
      const { rows } = await pool.query(
        `insert into receipt (id, trip_id, organizer_id, original_name, content_type, size_bytes, storage_key)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [receiptId, req.params.tripId, organizer, file.originalname?.slice(0, 200) ?? null, type.mime, file.size, storageKey],
      )
      enqueueExtraction(receiptId)
      res.status(201).json({ receipt: receiptJson(rows[0]!) })
    } catch (err) {
      if (storageKey) await deleteReceiptFile(storageKey)
      throw err
    }
  }),
)

/** Ownership: receipts are only visible through their organizer's trip. */
async function requireOwnedReceipt(receiptId: string, organizer: string) {
  const { rows } = await pool.query(
    `select r.* from receipt r join trip t on t.id = r.trip_id
      where r.id = $1 and t.organizer_id = $2`,
    [receiptId, organizer],
  )
  const row = rows[0] as Record<string, unknown> | undefined
  if (!row) throw notFound('receipt not found')
  return row
}

router.get(
  '/receipts/:receiptId',
  handler(async (req, res) => {
    const row = await requireOwnedReceipt(req.params.receiptId!, organizerId(req))
    res.json({ receipt: receiptJson(row) })
  }),
)

/** Authorized streaming of the private file — never a public static path. */
router.get(
  '/receipts/:receiptId/image',
  handler(async (req, res) => {
    const row = await requireOwnedReceipt(req.params.receiptId!, organizerId(req))
    const bytes = await readReceiptBytes(row.storage_key as string)
    res.setHeader('content-type', row.content_type as string)
    res.setHeader('cache-control', 'private, no-store')
    res.setHeader('content-disposition', `inline; filename="receipt-${row.id as string}"`)
    res.send(bytes)
  }),
)

const retrySchema = z.object({})

/** Re-queue a failed (or extracted-for-review) receipt. Idempotent by row claim. */
router.post(
  '/receipts/:receiptId/retry',
  receiptRetryLimiter.handler,
  handler(async (req, res) => {
    retrySchema.parse(req.body ?? {})
    const row = await requireOwnedReceipt(req.params.receiptId!, organizerId(req))
    const status = row.status as string
    if (status === 'confirmed') throw new HttpError(409, 'receipt is already attached to an expense')
    if (status === 'pending' || status === 'processing') throw new HttpError(409, 'extraction is already in progress')
    await pool.query(
      `update receipt set status = 'pending', error_kind = null, processing_error = null, updated_at = now() where id = $1`,
      [row.id],
    )
    enqueueExtraction(row.id as string)
    res.status(202).json({ receipt: { ...receiptJson(row), status: 'pending' } })
  }),
)

/** Discard an unattached receipt and its stored file. */
router.delete(
  '/receipts/:receiptId',
  handler(async (req, res) => {
    const row = await requireOwnedReceipt(req.params.receiptId!, organizerId(req))
    const { rowCount } = await pool.query('select 1 from expense where receipt_id = $1', [row.id])
    if (rowCount) throw new HttpError(409, 'receipt is attached to an expense; delete the expense first')
    await pool.query('delete from receipt where id = $1', [row.id])
    await deleteReceiptFile(row.storage_key as string)
    res.json({ ok: true })
  }),
)

export default router

import { Router } from 'express'
import { z } from 'zod'
import { organizerId } from '../auth.js'
import { handler } from '../http.js'
import { getMaskedSettings, testConnection, updateSettings } from '../ai/service.js'
import { aiTestLimiter } from '../rate-limit.js'

/**
 * Organizer-scoped receipt-AI settings. Responses are always masked: plaintext
 * keys are write-only (submitted over HTTPS, encrypted at rest, never read
 * back). Infrastructure endpoint changes stay server-operator env configuration.
 */
const router = Router()

const settingsSchema = z.object({
  mode: z.enum(['auto', 'local', 'gemini', 'tesseract']).nullable().optional(),
  geminiModel: z.string().trim().min(1).max(80).nullable().optional(),
  /** "" or null removes the saved override and restores the environment default. */
  geminiApiKey: z.string().trim().max(500).nullable().optional().refine(
    (k) => k === undefined || k === null || k === '' || k.length >= 8,
    'geminiApiKey must be at least 8 characters (or "" / null to remove)',
  ),
})

router.get(
  '/ai/settings',
  handler(async (req, res) => {
    res.json({ settings: await getMaskedSettings(organizerId(req)) })
  }),
)

router.put(
  '/ai/settings',
  handler(async (req, res) => {
    const body = settingsSchema.parse(req.body)
    const organizer = organizerId(req)
    // An empty string from the client means "remove my saved key".
    const rawKey = (req.body as { geminiApiKey?: unknown })?.geminiApiKey
    const geminiApiKey = rawKey === '' ? null : body.geminiApiKey
    await updateSettings(organizer, {
      mode: body.mode,
      geminiModel: body.geminiModel,
      geminiApiKey,
    })
    res.json({ settings: await getMaskedSettings(organizer) })
  }),
)

const testSchema = z.object({ provider: z.enum(['local', 'gemini']) })

router.post(
  '/ai/settings/test',
  aiTestLimiter.handler,
  handler(async (req, res) => {
    const body = testSchema.parse(req.body)
    const result = await testConnection(organizerId(req), body.provider)
    res.json(result)
  }),
)

export default router

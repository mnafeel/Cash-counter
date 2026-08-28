import { createHash } from 'crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'

initializeApp()

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim()).digest('hex')
}

function readBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  return match?.[1]?.trim() || null
}

function setCors(res: { set: (k: string, v: string) => void }): void {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
}

/**
 * GET /getWebsiteData
 * Header: Authorization: Bearer <apiKey>
 *
 * Returns JSON: { sales, customers, cashVisits, bankVisits, totals, ... }
 * published from Cash Counter when Website API is enabled.
 */
export const getWebsiteData = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET with Authorization: Bearer <apiKey>' })
    return
  }

  const apiKey =
    readBearerToken(req.get('Authorization') ?? undefined) ||
    (typeof req.query.key === 'string' ? req.query.key : null)

  if (!apiKey || !apiKey.startsWith('cc_')) {
    res.status(401).json({ error: 'Missing or invalid API key. Use Authorization: Bearer cc_…' })
    return
  }

  try {
    const db = getFirestore()
    const keyHash = hashApiKey(apiKey)
    const keySnap = await db.doc(`apiKeys/${keyHash}`).get()
    if (!keySnap.exists) {
      res.status(401).json({ error: 'API key not recognized' })
      return
    }

    const uid = String((keySnap.data() as { uid?: string }).uid || '')
    if (!uid) {
      res.status(401).json({ error: 'API key not linked to a store' })
      return
    }

    const configSnap = await db.doc(`users/${uid}/websiteApi/config`).get()
    const config = configSnap.data() as { enabled?: boolean } | undefined
    if (!configSnap.exists || config?.enabled !== true) {
      res.status(403).json({ error: 'Website API is disabled for this store' })
      return
    }

    const exportSnap = await db.doc(`users/${uid}/websiteApi/export`).get()
    if (!exportSnap.exists) {
      res.status(404).json({
        error: 'No export published yet. Open Cash Counter → Settings → Website API → Push export (or Save to cloud).',
      })
      return
    }

    const payload = exportSnap.data() || {}
    const { _updatedAt: _ignored, ...body } = payload as Record<string, unknown>
    void _ignored

    res.status(200).json(body)
  } catch (err) {
    logger.error('getWebsiteData failed', err)
    res.status(500).json({ error: 'Server error reading store data' })
  }
})

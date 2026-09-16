import { createHash } from 'crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { updateCloudAccount } from './cloudAccount'

initializeApp()

export { updateCloudAccount }

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

function parseExportBody(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw.body === 'string' && raw.body.trim()) {
    try {
      const parsed = JSON.parse(raw.body) as Record<string, unknown>
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }
  const { _updatedAt: _ignored, body: _body, ...rest } = raw
  void _ignored
  void _body
  return rest
}

/**
 * GET /getWebsiteData
 * Header: Authorization: Bearer <apiKey>
 *
 * Returns JSON: { sales, customers, cashVisits, bankVisits, adSpots, totals, ... }
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

    // Prefer public hash doc (same path ads sites use on Spark).
    const publicSnap = await db.doc(`websiteApiExports/${keyHash}`).get()
    if (publicSnap.exists) {
      const publicData = publicSnap.data() as Record<string, unknown>
      if (publicData.enabled === false) {
        res.status(403).json({ error: 'Website API is disabled for this store' })
        return
      }
      const fromPublic = parseExportBody(publicData)
      if (fromPublic) {
        res.status(200).json(fromPublic)
        return
      }
    }

    const exportSnap = await db.doc(`users/${uid}/websiteApi/export`).get()
    if (!exportSnap.exists) {
      res.status(404).json({
        error:
          'No export published yet. Open Cash Counter → Settings → Website API → Push export now, then fetch again.',
      })
      return
    }

    const fromPrivate = parseExportBody(exportSnap.data() as Record<string, unknown>)
    if (!fromPrivate) {
      res.status(404).json({
        error:
          'Export is empty or unreadable. Open Cash Counter → Settings → Website API → Push export now.',
      })
      return
    }

    res.status(200).json(fromPrivate)
  } catch (err) {
    logger.error('getWebsiteData failed', err)
    res.status(500).json({ error: 'Server error reading store data' })
  }
})

/**
 * Server-only Firebase Admin backup script.
 *
 * The React app uses the Firebase Web SDK (Settings → Cloud Backup).
 * This script is for manual/server backups with a service account key.
 *
 * Setup:
 *   npm install firebase-admin
 *   Download serviceAccountKey.json from Firebase Console → Project settings → Service accounts
 *   Set FIREBASE_SERVICE_ACCOUNT in .env or pass as env var
 *
 * Usage:
 *   node scripts/firebase-admin-backup.mjs push ./backup-data.json
 *   node scripts/firebase-admin-backup.mjs pull ./restored-data.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT ?? './serviceAccountKey.json'
const shopId = process.env.FIREBASE_SHOP_ID ?? 'shalimar-fashions'
const [command, fileArg] = process.argv.slice(2)

if (!command || !['push', 'pull'].includes(command)) {
  console.error('Usage: node scripts/firebase-admin-backup.mjs <push|pull> <file.json>')
  process.exit(1)
}

const filePath = resolve(fileArg ?? './cash-counter-backup.json')

let admin
try {
  admin = await import('firebase-admin')
} catch {
  console.error('Install firebase-admin first: npm install firebase-admin')
  process.exit(1)
}

if (!existsSync(serviceAccountPath)) {
  console.error(`Service account not found: ${serviceAccountPath}`)
  process.exit(1)
}

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'))

admin.default.initializeApp({
  credential: admin.default.credential.cert(serviceAccount),
})

const db = admin.default.firestore()
const docRef = db.collection('adminBackups').doc(shopId)

if (command === 'push') {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(filePath, 'utf8'))
  await docRef.set({
    ...data,
    _backupAt: new Date().toISOString(),
  })
  console.log(`Pushed backup to adminBackups/${shopId}`)
} else {
  const snap = await docRef.get()
  if (!snap.exists) {
    console.error('No admin backup found in Firestore')
    process.exit(1)
  }
  const { _backupAt, ...data } = snap.data()
  writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log(`Pulled backup from ${_backupAt} → ${filePath}`)
}

process.exit(0)

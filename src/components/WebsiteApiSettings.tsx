import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppData } from '../types'
import { isFirebaseConfigured } from '../firebase/config'
import { getCloudUser } from '../firebase/backup'
import {
  buildWebsiteApiCurlExample,
  buildWebsiteApiFirestoreFetchExample,
  disableWebsiteApi,
  getWebsiteApiBlazeUpgradeUrl,
  getWebsiteApiEndpointUrl,
  getWebsiteApiFirestoreUrl,
  getWebsiteExportQuickStats,
  hashWebsiteApiKey,
  previewWebsiteExport,
  pushWebsiteExport,
  registerWebsiteApiKey,
  scheduleWebsiteApiExport,
  setWebsiteApiEnabled,
  subscribeWebsiteApiStatus,
  type WebsiteApiStatus,
} from '../api/websiteApi'

interface WebsiteApiSettingsProps {
  data: AppData
  cloudLoggedIn: boolean
}

export default function WebsiteApiSettings({ data, cloudLoggedIn }: WebsiteApiSettingsProps) {
  const [apiStatus, setApiStatus] = useState<WebsiteApiStatus>(() => ({
    enabled: false,
    hasKey: false,
    apiKey: null,
    keyHash: null,
    lastPushedAt: null,
    storeId: null,
    connected: false,
    autoSync: false,
    lastTotals: null,
  }))
  const [keyHash, setKeyHash] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => subscribeWebsiteApiStatus(setApiStatus), [])

  useEffect(() => {
    let cancelled = false
    const apiKey = apiStatus.apiKey
    if (!apiKey) {
      setKeyHash(null)
      return
    }
    if (apiStatus.keyHash) {
      setKeyHash(apiStatus.keyHash)
      return
    }
    void hashWebsiteApiKey(apiKey).then((hash) => {
      if (!cancelled) setKeyHash(hash)
    })
    return () => {
      cancelled = true
    }
  }, [apiStatus.apiKey, apiStatus.keyHash])

  // Instant local counts only — never rebuild full cash/bank activity on Settings open.
  const quick = useMemo(() => getWebsiteExportQuickStats(data), [data])

  const enabled = apiStatus.enabled
  const apiKey = apiStatus.apiKey
  const lastPushedAt = apiStatus.lastPushedAt
  const endpoint = getWebsiteApiEndpointUrl()
  const firestoreUrl = keyHash ? getWebsiteApiFirestoreUrl(keyHash) : null
  const blazeUrl = getWebsiteApiBlazeUpgradeUrl()
  const firebaseOk = isFirebaseConfigured()
  const storeId = apiStatus.storeId ?? getCloudUser()?.uid ?? null
  const connected = Boolean(enabled && apiKey && cloudLoggedIn && storeId)

  const refreshNote = useCallback((message: string, isError = false) => {
    setError(isError)
    setStatus(message)
  }, [])

  async function handleGenerateKey() {
    if (!cloudLoggedIn) {
      refreshNote('Sign in under Cloud first.', true)
      return
    }
    setBusy(true)
    try {
      await registerWebsiteApiKey()
      setShowKey(true)
      scheduleWebsiteApiExport(data)
      refreshNote('API key created. Auto-publish is on — data will sync in the background.')
    } catch (err) {
      refreshNote(err instanceof Error ? err.message : 'Could not create API key', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleEnabled(next: boolean) {
    if (!next) {
      setBusy(true)
      try {
        await disableWebsiteApi()
        refreshNote('Website API turned off.')
      } catch (err) {
        refreshNote(err instanceof Error ? err.message : 'Could not disable API', true)
      } finally {
        setBusy(false)
      }
      return
    }

    if (!apiKey) {
      refreshNote('Generate an API key first.', true)
      return
    }
    setWebsiteApiEnabled(true)
    scheduleWebsiteApiExport(data)
    refreshNote('Website API on — auto-publishes whenever data changes.')
  }

  async function handlePush() {
    if (!cloudLoggedIn) {
      refreshNote('Sign in under Cloud first.', true)
      return
    }
    setBusy(true)
    try {
      const at = await pushWebsiteExport(data, { force: true })
      refreshNote(
        `Published · ${quick.salesCount} sales · ${quick.customerCount} customers · ${new Date(at).toLocaleString()}`,
      )
    } catch (err) {
      refreshNote(err instanceof Error ? err.message : 'Push failed', true)
    } finally {
      setBusy(false)
    }
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      refreshNote(`Copied ${label}.`)
    } catch {
      refreshNote(`Could not copy ${label}.`, true)
    }
  }

  function downloadJson() {
    // Heavy build only when the user asks for a file.
    const payload = previewWebsiteExport(data)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cash-counter-website-export-${payload.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    refreshNote('Downloaded export JSON.')
  }

  return (
    <div className="settings-scroll">
      <section className="settings-panel">
        <div className="settings-header">
          <h2>Website API</h2>
          <p>
            Give your new website read-only sale, customer, cash visit, and bank visit data via an
            API key. Changes publish automatically in the background.
          </p>
        </div>

        {!firebaseOk ? (
          <p className="settings-backup-meta settings-backup-meta--warn">Firebase is not configured.</p>
        ) : !cloudLoggedIn ? (
          <p className="settings-backup-meta settings-backup-meta--warn">
            Open Settings → Cloud and sign in first. The API publishes from your cloud store.
          </p>
        ) : (
          <div className="settings-backup-open">
            <p className="settings-backup-meta">
              {connected ? 'Connected' : enabled && apiKey ? 'Ready' : 'Not connected'}
              {storeId ? ` · Store ${storeId}` : ''}
              {apiStatus.autoSync ? ' · Auto-publish on' : ''}
            </p>
            {firestoreUrl ? (
              <p className="settings-backup-meta">
                Live URL connected · website reads this export for this store
              </p>
            ) : null}
          </div>
        )}

        <div className="settings-backup-summary">
          <span>{quick.salesCount} sales</span>
          <span>{quick.customerCount} customers</span>
          <span>{quick.expenseCount} expenses</span>
          {apiStatus.lastTotals ? (
            <>
              <span>Last push {apiStatus.lastTotals.salesCount} sales</span>
              <span>{apiStatus.lastTotals.customerCount} customers</span>
            </>
          ) : null}
        </div>

        <label className="settings-backup-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || !apiKey}
            onChange={(e) => void handleToggleEnabled(e.target.checked)}
          />
          Enable Website API (auto-publish when data changes)
        </label>

        <div className="settings-backup-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !cloudLoggedIn || !firebaseOk}
            onClick={() => void handleGenerateKey()}
          >
            {apiKey ? 'Rotate API key' : 'Generate API key'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !enabled || !apiKey || !cloudLoggedIn}
            onClick={() => void handlePush()}
          >
            Push export now
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={downloadJson}>
            Download JSON
          </button>
        </div>

        {apiKey ? (
          <div className="settings-backup-open">
            <p className="settings-backup-meta">API key</p>
            <code className="settings-website-api-key">
              {showKey ? apiKey : `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}`}
            </code>
            <div className="settings-backup-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? 'Hide key' : 'Show key'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void copyText('API key', apiKey)}
              >
                Copy key
              </button>
            </div>
          </div>
        ) : null}

        <div className="settings-backup-open">
          <p className="settings-backup-meta">Live data URL (works now · Spark)</p>
          {firestoreUrl ? (
            <>
              <code className="settings-website-api-key">{firestoreUrl}</code>
              <div className="settings-backup-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void copyText('Firestore URL', firestoreUrl)}
                >
                  Copy Firestore URL
                </button>
                {keyHash ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() =>
                      void copyText('fetch example', buildWebsiteApiFirestoreFetchExample(keyHash))
                    }
                  >
                    Copy fetch code
                  </button>
                ) : null}
              </div>
              <p className="settings-backup-meta">
                Response field <code>fields.body.stringValue</code> is JSON with{' '}
                <code>sales</code>, <code>customers</code>, <code>cashVisits</code>,{' '}
                <code>bankVisits</code>. Connected store updates this URL automatically.
              </p>
            </>
          ) : (
            <p className="settings-backup-meta">Generate an API key to get the live URL.</p>
          )}
        </div>

        <div className="settings-backup-open">
          <p className="settings-backup-meta">Cloud Function URL (needs Blaze plan)</p>
          <code className="settings-website-api-key">{endpoint}</code>
          <div className="settings-backup-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void copyText('endpoint', endpoint)}
            >
              Copy URL
            </button>
            {apiKey ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void copyText('curl example', buildWebsiteApiCurlExample(apiKey))}
              >
                Copy curl
              </button>
            ) : null}
            <a className="btn btn-ghost" href={blazeUrl} target="_blank" rel="noreferrer">
              Upgrade to Blaze
            </a>
          </div>
          <p className="settings-backup-meta">
            Header: <code>Authorization: Bearer &lt;apiKey&gt;</code>
            <br />
            Use the same API key on your website to fetch this store&apos;s data.
          </p>
          {lastPushedAt ? (
            <p className="settings-backup-meta">
              Last published {new Date(lastPushedAt).toLocaleString()}
              {connected ? ' · auto-sync active' : ''}
            </p>
          ) : (
            <p className="settings-backup-meta">
              Not published yet — enable API or tap Push export now.
            </p>
          )}
        </div>

        {status ? (
          <p className={`settings-backup-status ${error ? 'settings-backup-status--error' : ''}`}>
            {status}
          </p>
        ) : null}
      </section>
    </div>
  )
}

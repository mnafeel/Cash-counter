import { useEffect, useState } from 'react'
import { subscribeToAuth } from '../firebase/backup'
import { cloudConsoleLinks, fetchCloudUsage, type CloudUsageReport } from '../firebase/cloudUsage'
import './CloudUsageSettings.css'

export default function CloudBillingBanner() {
  const [report, setReport] = useState<CloudUsageReport | null>(null)
  useEffect(() => {
    let active = true
    let generation = 0
    let timer: ReturnType<typeof setInterval> | undefined
    const unsubscribe = subscribeToAuth((user) => {
      generation++
      const current = generation
      setReport(null)
      if (timer) clearInterval(timer)
      if (!user) return
      const update = () => {
        if (document.visibilityState === 'hidden') return
        void fetchCloudUsage(user.uid).then((value) => {
          if (active && current === generation) setReport(value)
        }).catch(() => {
          // Keep an already verified warning visible during a temporary outage.
          // Account changes clear it above, so reports cannot cross accounts.
        })
      }
      update()
      timer = setInterval(update, 5 * 60000)
    })
    return () => { active = false; generation++; unsubscribe(); if (timer) clearInterval(timer) }
  }, [])
  if (!report?.alerts.length) return null
  return <aside className="cloud-billing-banner" role="alert" aria-label="Cloud billing alert">
    <p>{report.alerts.map((alert) => alert.message).join(' ')} <small>Last checked {new Date(report.checkedAt).toLocaleString()}.</small></p>
    <a href={cloudConsoleLinks(report.projectId).billing} target="_blank" rel="noreferrer">Review billing</a>
  </aside>
}

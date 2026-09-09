import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import { useOpenTiming } from '../hooks/useOpenTiming'
import ReportsPanel, { type ReportSection } from '../components/ReportsPanel'
import CreditDashboard from '../components/CreditDashboard'
import { useAppPageBack } from '../hooks/useAppPageBack'
import type { ReportDatePreset } from '../utils/reportsHub'

const REPORT_PRESETS: ReportDatePreset[] = [
  'today',
  'yesterday',
  'week',
  'date',
  'range',
  'month',
  'monthPick',
]

const REPORT_SECTIONS: ReportSection[] = [
  'all',
  'sales',
  'purchase',
  'expense',
  'expense-report',
  'not-sale',
  'credit',
  'cheque',
  'loan',
]

function parseReportPreset(value: string | null): ReportDatePreset {
  if (value && REPORT_PRESETS.includes(value as ReportDatePreset)) {
    return value as ReportDatePreset
  }
  return 'today'
}

function parseReportSection(value: string | null): ReportSection | undefined {
  if (value && REPORT_SECTIONS.includes(value as ReportSection)) {
    return value as ReportSection
  }
  return undefined
}

export default function Reports() {
  useOpenTiming('Reports', true, false)
  const [searchParams] = useSearchParams()
  const { data, setCustomerReminder, setBillReminder, updateReminderAlertSettings, applySaleReturn, cancelSaleReturn } = useCash()
  const goBack = useAppPageBack('/', { route: '/reports' })
  const [customerName, setCustomerName] = useState<string | undefined>()

  const initialPreset = useMemo(
    () => parseReportPreset(searchParams.get('preset')),
    [searchParams],
  )
  const initialSection = useMemo(
    () => parseReportSection(searchParams.get('section')),
    [searchParams],
  )
  const initialSelectedDate = searchParams.get('date') ?? ''
  const focusSection = searchParams.get('focus') === '1' && Boolean(initialSection)

  return (
    <>
      <ReportsPanel
        open
        data={data}
        onClose={goBack}
        initialPreset={initialPreset}
        initialSelectedDate={initialSelectedDate}
        initialSection={initialSection}
        focusSection={focusSection}
        onOpenCustomer={(name) => setCustomerName(name)}
      />

      <CreditDashboard
        open={Boolean(customerName)}
        onClose={() => setCustomerName(undefined)}
        data={data}
        initialCustomer={customerName}
        initialFilter="credit"
        onSetCustomerReminder={setCustomerReminder}
        onSetBillReminder={setBillReminder}
        onSaveAlertSettings={updateReminderAlertSettings}
        onApplySaleReturn={applySaleReturn}
        onCancelSaleReturn={cancelSaleReturn}
      />
    </>
  )
}

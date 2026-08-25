import { useState } from 'react'
import { useCash } from '../context/CashContext'
import { useOpenTiming } from '../hooks/useOpenTiming'
import ReportsPanel from '../components/ReportsPanel'
import CreditDashboard from '../components/CreditDashboard'
import { useAppPageBack } from '../hooks/useAppPageBack'

export default function Reports() {
  useOpenTiming('Reports', true, false)
  const { data, setCustomerReminder, setBillReminder, updateReminderAlertSettings } = useCash()
  const goBack = useAppPageBack('/', { route: '/reports' })
  const [customerName, setCustomerName] = useState<string | undefined>()

  return (
    <>
      <ReportsPanel
        open
        data={data}
        onClose={goBack}
        initialPreset="today"
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
      />
    </>
  )
}

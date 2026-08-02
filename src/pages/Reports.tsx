import { useState } from 'react'
import { useCash } from '../context/CashContext'
import ReportsPanel from '../components/ReportsPanel'
import CreditDashboard from '../components/CreditDashboard'
import { useAppPageBack } from '../hooks/useAppPageBack'

export default function Reports() {
  const { data, setCustomerReminder, updateReminderAlertSettings } = useCash()
  const goBack = useAppPageBack()
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
        onSaveAlertSettings={updateReminderAlertSettings}
      />
    </>
  )
}

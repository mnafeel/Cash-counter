import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import ReportsPanel from '../components/ReportsPanel'
import CreditDashboard from '../components/CreditDashboard'

export default function Reports() {
  const { data, setCustomerReminder, updateReminderAlertSettings } = useCash()
  const navigate = useNavigate()
  const [customerName, setCustomerName] = useState<string | undefined>()

  return (
    <>
      <ReportsPanel
        open
        data={data}
        onClose={() => navigate('/')}
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

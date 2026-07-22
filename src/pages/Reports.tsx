import { useNavigate } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import ReportsPanel from '../components/ReportsPanel'

export default function Reports() {
  const { data } = useCash()
  const navigate = useNavigate()

  return (
    <ReportsPanel
      open
      data={data}
      onClose={() => navigate('/')}
      initialPreset="today"
    />
  )
}

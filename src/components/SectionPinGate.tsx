import PinEntry from './PinEntry'
import { useCashActions } from '../context/CashContext'
import { useCashSnapshot } from '../hooks/useCashSnapshot'
import { getAccessPin } from '../utils/accessPin'

type SectionPinGateProps = {
  title?: string
}

export default function SectionPinGate({ title = 'Secure area' }: SectionPinGateProps) {
  const { data } = useCashSnapshot(true)
  const { unlockSensitive } = useCashActions()
  const accessPin = getAccessPin(data)

  return (
    <PinEntry
      title={title}
      subtitle="Enter your 4-digit PIN to continue."
      verifyPin={(pin) => pin === accessPin}
      onUnlock={unlockSensitive}
    />
  )
}

import PinEntry from './PinEntry'
import { useCashActions } from '../context/CashContext'
import { useCashSnapshot } from '../hooks/useCashSnapshot'
import { getPinEntryLength, verifyUserPin } from '../utils/accessPin'

type SectionPinGateProps = {
  title?: string
}

export default function SectionPinGate({ title = 'Secure area' }: SectionPinGateProps) {
  const { data } = useCashSnapshot(true)
  const { unlockHome } = useCashActions()
  return (
    <PinEntry
      title={title}
      verifyPin={(pin) => verifyUserPin(data, pin)}
      onUnlock={unlockHome}
      pinLength={getPinEntryLength(data)}
    />
  )
}

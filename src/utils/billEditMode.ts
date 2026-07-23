const BILL_EDIT_MODE_KEY = 'cash-counter-bill-edit-mode'

export function readBillEditMode(): boolean {
  try {
    return localStorage.getItem(BILL_EDIT_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeBillEditMode(enabled: boolean): void {
  try {
    localStorage.setItem(BILL_EDIT_MODE_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore storage errors */
  }
  window.dispatchEvent(new CustomEvent('bill-edit-mode', { detail: enabled }))
}

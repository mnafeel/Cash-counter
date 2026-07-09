import { useCash } from '../context/CashContext'
import { formatDate, formatMoney } from '../utils/format'
import './History.css'

export default function History() {
  const { data, removeSale, removeExpense } = useCash()

  const items = [
    ...data.sales.map((s) => {
      const payLabel =
        s.status === 'pending'
          ? '💳 Credit · Pending'
          : s.payType === 'bank'
            ? '🏦 Bank'
            : s.payType === 'credit'
              ? '💳 Credit'
              : s.payType === 'split'
                ? `💵 ${formatMoney(s.cashAmount ?? 0)} · 🏦 ${formatMoney(s.bankAmount ?? 0)}`
                : '💵 Cash'
      const orig =
        s.originalBillAmount && s.originalBillAmount !== s.billAmount
          ? `Bill ${formatMoney(s.originalBillAmount)} → `
          : ''
      return {
        type: 'sale' as const,
        id: s.id,
        amount: s.billAmount,
        sub: `${orig}${s.status === 'pending' ? 'Pending · ' : s.payType === 'bank' || s.payType === 'credit' ? 'Paid ' : `Give ${formatMoney(s.paidAmount)} · `}${payLabel}${s.changeAmount > 0 ? ` · Change ${formatMoney(s.changeAmount)}` : ''}`,
        name: s.customerName,
        date: s.createdAt,
      }
    }),
    ...data.expenses.map((e) => ({
      type: 'expense' as const,
      id: e.id,
      amount: e.amount,
      sub: e.note,
      name: undefined as string | undefined,
      date: e.createdAt,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  function handleDelete(type: 'sale' | 'expense', id: string) {
    if (!confirm('Delete this record?')) return
    if (type === 'sale') removeSale(id)
    else removeExpense(id)
  }

  return (
    <div className="history-page">
      <div className="history-header">
        <h2>History</h2>
        <p>{items.length} saved records</p>
      </div>

      {items.length === 0 ? (
        <div className="history-empty">
          <span>📋</span>
          <p>No records yet. Use Cash Counter to save bills.</p>
        </div>
      ) : (
        <ul className="history-list">
          {items.map((item) => (
            <li key={item.id} className={`history-item history-item--${item.type}`}>
              <div className="history-item-main">
                <span className="history-item-icon">{item.type === 'sale' ? '💵' : '📤'}</span>
                <div className="history-item-info">
                  <div className="history-item-top">
                    <span className="history-item-type">
                      {item.type === 'sale' ? 'Bill Collected' : 'Expense'}
                    </span>
                    {item.name && <span className="history-item-name">{item.name}</span>}
                  </div>
                  <span className="history-item-sub">{item.sub}</span>
                  <span className="history-item-date">{formatDate(item.date)}</span>
                </div>
                <span
                  className={`history-item-amount ${item.type === 'expense' ? 'negative' : ''}`}
                >
                  {item.type === 'expense' ? '-' : '+'}
                  {formatMoney(item.amount)}
                </span>
              </div>
              <button
                type="button"
                className="history-delete"
                onClick={() => handleDelete(item.type, item.id)}
                aria-label="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

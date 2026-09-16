import { useDeferredValue, useState, type ReactNode } from 'react'
import type { AdvanceHistoryDateFilter } from '../components/AdvanceCustomerLedgerList'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useOpenTiming } from '../hooks/useOpenTiming'
import { useAppPageBack } from '../hooks/useAppPageBack'
import AdvanceCustomerLedgerList from '../components/AdvanceCustomerLedgerList'
import AdvanceRecordPanel from '../components/AdvanceRecordPanel'
import AdvanceSettingsPanel from '../components/AdvanceSettingsPanel'
import ReturnLookupPanel from '../components/ReturnLookupPanel'
import UtilitiesNavIcon from '../components/UtilitiesNavIcon'
import {
  UtilitiesAdvanceIcon,
  UtilitiesAdvanceSettingsIcon,
  UtilitiesReturnIcon,
} from '../components/UtilitiesHubIcons'
import './Utilities.css'

function UtilitiesShell({ children, showBack }: { children: ReactNode; showBack?: boolean }) {
  return (
    <div className="utilities-page">
      {showBack ? (
        <div className="utilities-subnav">
          <Link to="/utilities" className="utilities-back">← Utilities</Link>
        </div>
      ) : null}
      {children}
    </div>
  )
}

function UtilitiesHub() {
  const navigate = useNavigate()
  return (
    <UtilitiesShell>
      <div className="utilities-hub utilities-animate-in">
        <header className="utilities-hero">
          <div className="utilities-hero-icon" aria-hidden="true">
            <UtilitiesNavIcon className="utilities-hero-icon__svg" />
          </div>
          <div>
            <h1 className="utilities-hero-title">Utilities</h1>
            <p className="utilities-hero-sub">Tools and records — more modules coming soon</p>
          </div>
        </header>
        <div className="utilities-hub-grid">
          <button
            type="button"
            className="utilities-hub-card utilities-hub-card--advance"
            onClick={() => navigate('advance')}
          >
            <span className="utilities-hub-card__glow" aria-hidden="true" />
            <UtilitiesAdvanceIcon className="utilities-hub-card__icon-svg" />
            <span className="utilities-hub-card__title">Advance</span>
            <span className="utilities-hub-card__sub">Balances · history · record</span>
          </button>
          <button
            type="button"
            className="utilities-hub-card utilities-hub-card--return"
            onClick={() => navigate('return')}
          >
            <span className="utilities-hub-card__glow" aria-hidden="true" />
            <UtilitiesReturnIcon className="utilities-hub-card__icon-svg" />
            <span className="utilities-hub-card__title">Return</span>
            <span className="utilities-hub-card__sub">Search returns · item details</span>
          </button>
        </div>
      </div>
    </UtilitiesShell>
  )
}

type AdvanceTab = 'open' | 'history'

const ADVANCE_HISTORY_DATE_OPTIONS: { id: AdvanceHistoryDateFilter; label: string }[] = [
  { id: 'all', label: 'All advance' },
  { id: 'today', label: "Today's advance" },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'date', label: 'Pick date…' },
]

function AdvancePage() {
  const [advanceTab, setAdvanceTab] = useState<AdvanceTab>('open')
  const [historySearch, setHistorySearch] = useState('')
  const [historyDateFilter, setHistoryDateFilter] = useState<AdvanceHistoryDateFilter>('all')
  const [historySelectedDate, setHistorySelectedDate] = useState('')
  const [showCreateAdvance, setShowCreateAdvance] = useState(false)
  const [showAdvanceSettings, setShowAdvanceSettings] = useState(false)
  const deferredHistorySearch = useDeferredValue(historySearch)

  return (
    <UtilitiesShell showBack>
      <section className="utilities-pane utilities-pane--full utilities-pane--advance utilities-animate-in">
        <div className="utilities-pane-toolbar">
          <h2 className="utilities-pane-title">Advance</h2>
          <div className="utilities-pane-actions">
            <button
              type="button"
              className="utilities-icon-btn"
              aria-label="Advance settings"
              title="Advance settings"
              onClick={() => setShowAdvanceSettings(true)}
            >
              <UtilitiesAdvanceSettingsIcon className="utilities-icon-btn__svg" />
            </button>
            <button
              type="button"
              className="utilities-create-btn"
              onClick={() => setShowCreateAdvance(true)}
            >
              Create advance
            </button>
          </div>
        </div>

        <div className="utilities-tabs utilities-tabs--advance" role="tablist" aria-label="Advance views">
          <button
            type="button"
            role="tab"
            className="utilities-tab"
            aria-selected={advanceTab === 'open'}
            onClick={() => setAdvanceTab('open')}
          >
            Open
          </button>
          <button
            type="button"
            role="tab"
            className="utilities-tab"
            aria-selected={advanceTab === 'history'}
            onClick={() => setAdvanceTab('history')}
          >
            History
          </button>
        </div>

        {showCreateAdvance ? (
          <div
            className="utilities-modal-overlay"
            role="presentation"
            onMouseDown={() => setShowCreateAdvance(false)}
          >
            <div
              className="utilities-modal-sheet"
              role="dialog"
              aria-label="Create advance"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="utilities-modal-head">
                <h3>Create advance</h3>
                <button
                  type="button"
                  className="utilities-modal-close"
                  aria-label="Close"
                  onClick={() => setShowCreateAdvance(false)}
                >
                  ×
                </button>
              </div>
              <AdvanceRecordPanel
                compact
                formOnly
                numpadRoutePrefix="/utilities"
                onSaved={() => setShowCreateAdvance(false)}
              />
            </div>
          </div>
        ) : null}

        {showAdvanceSettings ? (
          <div
            className="utilities-modal-overlay"
            role="presentation"
            onMouseDown={() => setShowAdvanceSettings(false)}
          >
            <div
              className="utilities-modal-sheet utilities-modal-sheet--settings"
              role="dialog"
              aria-label="Advance settings"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="utilities-modal-head">
                <h3>Advance settings</h3>
                <button
                  type="button"
                  className="utilities-modal-close"
                  aria-label="Close"
                  onClick={() => setShowAdvanceSettings(false)}
                >
                  ×
                </button>
              </div>
              <AdvanceSettingsPanel />
            </div>
          </div>
        ) : null}

        {advanceTab === 'history' ? (
          <div className="utilities-advance-history-filters">
            <div
              className="utilities-tabs utilities-tabs--advance-sub"
              role="tablist"
              aria-label="Advance history period"
            >
              {ADVANCE_HISTORY_DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  className="utilities-tab utilities-tab--sub"
                  aria-selected={historyDateFilter === opt.id}
                  onClick={() => setHistoryDateFilter(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {historyDateFilter === 'date' ? (
              <input
                className="utilities-advance-date-input"
                type="date"
                value={historySelectedDate}
                onChange={(e) => setHistorySelectedDate(e.target.value)}
                aria-label="Advance history date"
              />
            ) : null}
          </div>
        ) : null}

        <input
          className="utilities-search"
          type="search"
          value={historySearch}
          onChange={(e) => setHistorySearch(e.target.value)}
          placeholder={advanceTab === 'open' ? 'Filter open balances' : 'Filter by customer'}
          aria-label="Filter advance list"
        />
        <AdvanceCustomerLedgerList
          mode={advanceTab}
          search={deferredHistorySearch}
          historyDateFilter={historyDateFilter}
          historySelectedDate={historySelectedDate}
        />
      </section>
    </UtilitiesShell>
  )
}

function ReturnPage() {
  return (
    <UtilitiesShell showBack>
      <section className="utilities-pane utilities-pane--full utilities-animate-in">
        <h2 className="utilities-pane-title">Return lookup</h2>
        <ReturnLookupPanel />
      </section>
    </UtilitiesShell>
  )
}

function LegacyAdjustmentsRedirect() {
  const location = useLocation()
  const target = location.pathname.replace(/^\/adjustments/, '/utilities') || '/utilities'
  return <Navigate to={target} replace />
}

export default function Utilities() {
  useOpenTiming('Utilities', true, false)
  const location = useLocation()
  useAppPageBack('/', { route: '/utilities' })

  if (location.pathname.startsWith('/adjustments')) {
    return <LegacyAdjustmentsRedirect />
  }

  return (
    <Routes>
      <Route index element={<UtilitiesHub />} />
      <Route path="advance" element={<AdvancePage />} />
      <Route path="return" element={<ReturnPage />} />
      <Route path="*" element={<Navigate to="/utilities" replace />} />
    </Routes>
  )
}

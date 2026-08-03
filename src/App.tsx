import { lazy, Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { CashProvider } from './context/CashContext'
import Layout from './components/Layout'
import HashRouteFix from './components/HashRouteFix'
import AppBootScreen from './components/AppBootScreen'

const Home = lazy(() => import('./pages/Home'))
const Counter = lazy(() => import('./pages/Counter'))
const PurchaseExpense = lazy(() => import('./pages/PurchaseExpense'))
const Expenses = lazy(() => import('./pages/Expenses'))
const History = lazy(() => import('./pages/History'))
const Loan = lazy(() => import('./pages/Loan'))
const Staff = lazy(() => import('./pages/Staff'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
  return (
    <CashProvider>
      <HashRouter>
        <Suspense fallback={<AppBootScreen />}>
          <Routes>
            <Route element={<HashRouteFix />}>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="counter" element={<Counter />} />
                <Route path="purchase" element={<PurchaseExpense />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="history" element={<History />} />
                <Route path="loan" element={<Loan />} />
                <Route path="staff" element={<Staff />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </CashProvider>
  )
}

import { HashRouter, Route, Routes } from 'react-router-dom'
import { CashProvider } from './context/CashContext'
import Layout from './components/Layout'
import HashRouteFix from './components/HashRouteFix'
import Home from './pages/Home'
import Counter from './pages/Counter'
import PurchaseExpense from './pages/PurchaseExpense'
import Expenses from './pages/Expenses'
import History from './pages/History'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

export default function App() {
  return (
    <CashProvider>
      <HashRouter>
        <Routes>
          <Route element={<HashRouteFix />}>
            <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="counter" element={<Counter />} />
            <Route path="purchase" element={<PurchaseExpense />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="history" element={<History />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
    </CashProvider>
  )
}

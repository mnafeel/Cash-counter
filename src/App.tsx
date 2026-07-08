import { HashRouter, Route, Routes } from 'react-router-dom'
import { CashProvider } from './context/CashContext'
import Layout from './components/Layout'
import Home from './pages/Home'
import Counter from './pages/Counter'
import Expenses from './pages/Expenses'
import History from './pages/History'
import Settings from './pages/Settings'

export default function App() {
  return (
    <CashProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="counter" element={<Counter />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="history" element={<History />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </HashRouter>
    </CashProvider>
  )
}

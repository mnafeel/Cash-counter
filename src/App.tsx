import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { CashProvider } from './context/CashContext'
import Layout from './components/Layout'
import HashRouteFix from './components/HashRouteFix'
import AppBootScreen from './components/AppBootScreen'
import Home from './pages/Home'
import Counter from './pages/Counter'
import Expenses from './pages/Expenses'
import History from './pages/History'

const PurchaseExpense = lazy(() => import('./pages/PurchaseExpense'))
const Loan = lazy(() => import('./pages/Loan'))
const Staff = lazy(() => import('./pages/Staff'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppBootScreen />}>{children}</Suspense>
}

function prefetchLazyRoutes() {
  void import('./pages/PurchaseExpense')
  void import('./pages/Loan')
  void import('./pages/Staff')
  void import('./pages/Reports')
  void import('./pages/Settings')
}

export default function App() {
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => prefetchLazyRoutes(), { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const timer = window.setTimeout(prefetchLazyRoutes, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <CashProvider>
      <HashRouter>
        <Routes>
          <Route element={<HashRouteFix />}>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="counter" element={<Counter />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="history" element={<History />} />
              <Route
                path="purchase"
                element={
                  <LazyPage>
                    <PurchaseExpense />
                  </LazyPage>
                }
              />
              <Route
                path="loan"
                element={
                  <LazyPage>
                    <Loan />
                  </LazyPage>
                }
              />
              <Route
                path="staff"
                element={
                  <LazyPage>
                    <Staff />
                  </LazyPage>
                }
              />
              <Route
                path="reports"
                element={
                  <LazyPage>
                    <Reports />
                  </LazyPage>
                }
              />
              <Route
                path="settings"
                element={
                  <LazyPage>
                    <Settings />
                  </LazyPage>
                }
              />
            </Route>
          </Route>
        </Routes>
      </HashRouter>
    </CashProvider>
  )
}

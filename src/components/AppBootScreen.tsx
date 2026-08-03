/** Shown while route chunks load after the initial HTML boot screen. */
export default function AppBootScreen() {
  return (
    <div className="app-boot-screen" aria-live="polite" aria-busy="true">
      <p className="app-boot-screen-title">Shalimar Fashions</p>
      <p className="app-boot-screen-sub">Loading…</p>
      <div className="app-boot-screen-spinner" aria-hidden="true" />
    </div>
  )
}

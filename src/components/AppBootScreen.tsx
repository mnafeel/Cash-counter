/** Shown while route chunks load after the initial HTML boot screen. */
export default function AppBootScreen() {
  const logoUrl = `${import.meta.env.BASE_URL}logo.png`

  return (
    <div className="app-boot-screen" aria-live="polite" aria-busy="true">
      <div className="app-boot-screen-glow" aria-hidden="true" />
      <img src={logoUrl} alt="" className="app-boot-screen-logo" aria-hidden="true" />
      <p className="app-boot-screen-title">Shalimar Fashions</p>
      <p className="app-boot-screen-sub">Loading your workspace…</p>
      <div className="app-boot-screen-spinner" aria-hidden="true">
        <span className="app-boot-screen-spinner-ring" />
        <span className="app-boot-screen-spinner-core" />
      </div>
    </div>
  )
}

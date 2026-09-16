export function UtilitiesAdvanceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="util-adv-face" x1="8" y1="6" x2="40" y2="42">
          <stop stopColor="#3d4f6a" />
          <stop offset="1" stopColor="#1e2838" />
        </linearGradient>
        <linearGradient id="util-adv-shine" x1="12" y1="8" x2="36" y2="28">
          <stop stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="6" y="10" width="36" height="26" rx="6" fill="url(#util-adv-face)" />
      <rect x="6" y="10" width="36" height="12" rx="6" fill="url(#util-adv-shine)" />
      <rect x="8" y="34" width="32" height="4" rx="2" fill="#0d1118" opacity="0.5" />
      <circle cx="34" cy="22" r="5" fill="#c9a227" />
      <path d="M32 22h4M34 20v4" stroke="#1a1510" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function UtilitiesReturnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="util-ret-ring" x1="10" y1="8" x2="38" y2="40">
          <stop stopColor="#5eead4" />
          <stop offset="1" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <path
        d="M14 24a10 10 0 0 1 17.3-7.3"
        stroke="url(#util-ret-ring)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path d="M28 12l4 4-4 4" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="12" y="26" width="24" height="14" rx="4" fill="#1e2838" stroke="rgba(255,255,255,0.12)" />
      <path d="M16 32h16M16 36h10" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

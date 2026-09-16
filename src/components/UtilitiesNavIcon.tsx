/** Sidebar / nav mark for Utilities — lightweight SVG (no emoji font). */
export default function UtilitiesNavIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="util-nav-grad" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5d78e" />
          <stop offset="0.55" stopColor="#c9a227" />
          <stop offset="1" stopColor="#8a6b1a" />
        </linearGradient>
      </defs>
      <rect x="3" y="4" width="18" height="16" rx="4" fill="url(#util-nav-grad)" opacity="0.95" />
      <path
        d="M8 9h8M8 12.5h5.5M8 16h3"
        stroke="#1a1510"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="17" cy="8" r="2.25" fill="#1a1510" opacity="0.35" />
    </svg>
  )
}

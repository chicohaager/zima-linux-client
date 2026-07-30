/** Inline icons — no icon font, no remote asset, so packaging stays self-contained. */

const base = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const FolderIcon = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z" />
  </svg>
)

export const PhotoIcon = (): React.JSX.Element => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="8.5" cy="10" r="1.6" />
    <path d="M4 17l5-4.5 3.5 3L16 12l4 4" />
  </svg>
)

export const GridIcon = (): React.JSX.Element => (
  <svg {...base}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </svg>
)

export const WifiIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M4.5 9a10 10 0 0 1 15 0" />
    <path d="M7.5 12.2a6 6 0 0 1 9 0" />
    <circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

export const SearchIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <circle cx="11" cy="11" r="6" />
    <path d="M15.5 15.5L20 20" />
  </svg>
)

export const WarningIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M12 4.5l8 14H4z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

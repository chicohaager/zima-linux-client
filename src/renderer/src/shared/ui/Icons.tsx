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

export const PlusIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const UploadIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M12 16V5" />
    <path d="M7.5 9.5L12 5l4.5 4.5" />
    <path d="M5 18.5h14" />
  </svg>
)

export const DownloadIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M12 5v11" />
    <path d="M7.5 11.5L12 16l4.5-4.5" />
    <path d="M5 19h14" />
  </svg>
)

export const TrashIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M5 7h14" />
    <path d="M9 7V5h6v2" />
    <path d="M6.5 7l.8 12h9.4l.8-12" />
  </svg>
)

export const CopyIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <rect x="4" y="4" width="11" height="11" rx="2" />
    <path d="M9 20h9a2 2 0 0 0 2-2V9" />
  </svg>
)

export const ScissorsIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <circle cx="6.5" cy="17" r="2.2" />
    <circle cx="17.5" cy="17" r="2.2" />
    <path d="M8 15.4L18 5M16 15.4L6 5" />
  </svg>
)

export const RefreshIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M19 12a7 7 0 1 1-2.1-5" />
    <path d="M19 4.5V9h-4.5" />
  </svg>
)

export const PowerIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M12 4.5v7" />
    <path d="M7.5 7.8a6.5 6.5 0 1 0 9 0" />
  </svg>
)

export const PlayIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M8 5.5l11 6.5-11 6.5z" />
  </svg>
)

export const StopIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </svg>
)

export const ExternalIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M14 5h5v5" />
    <path d="M19 5l-7.5 7.5" />
    <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </svg>
)

export const ChevronLeftIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M14 6l-6 6 6 6" />
  </svg>
)

export const CloudIcon = (): React.JSX.Element => (
  <svg {...base} width={18} height={18}>
    <path d="M7 18h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 12.2A3 3 0 0 0 7 18Z" />
  </svg>
)

interface CardProps {
  readonly children: React.ReactNode
  readonly className?: string
}

/** White card with a large radius and a soft shadow — the basic surface of the app. */
export const Card = ({ children, className = '' }: CardProps): React.JSX.Element => (
  <section
    className={`rounded-2xl p-4 ${className}`}
    style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}
  >
    {children}
  </section>
)

/** Full-width pill used for connection state and progress, as in the mobile client. */
export const Pill = ({ children, className = '' }: CardProps): React.JSX.Element => (
  <div
    className={`flex items-center gap-2 rounded-[999px] px-4 py-3 ${className}`}
    style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}
  >
    {children}
  </div>
)

export const SectionTitle = ({ children }: CardProps): React.JSX.Element => (
  <h1 className="mb-4 text-3xl font-semibold tracking-tight">{children}</h1>
)

export const Muted = ({ children, className = '' }: CardProps): React.JSX.Element => (
  <p className={`text-sm ${className}`} style={{ color: 'var(--text-muted)' }}>
    {children}
  </p>
)

interface ButtonProps {
  readonly children: React.ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly variant?: 'primary' | 'secondary' | 'danger'
  readonly type?: 'button' | 'submit'
  readonly title?: string
  readonly className?: string
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--accent-contrast)' },
  secondary: { background: 'var(--surface-sunken)', color: 'var(--text-strong)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
}

export const Button = ({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  type = 'button',
  title,
  className = '',
}: ButtonProps): React.JSX.Element => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`flex items-center justify-center gap-2 rounded-[999px] px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-55 ${className}`}
    style={VARIANTS[variant]}
  >
    {children}
  </button>
)

interface FieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: 'text' | 'password'
  readonly placeholder?: string
  readonly autoFocus?: boolean
  readonly name: string
}

export const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoFocus = false,
  name,
}: FieldProps): React.JSX.Element => (
  <label className="flex flex-col gap-1.5 text-sm">
    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
    <input
      name={name}
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete={type === 'password' ? 'current-password' : 'off'}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-xl px-3.5 py-2.5 outline-none"
      style={{
        background: 'var(--surface-sunken)',
        color: 'var(--text-strong)',
        border: '1px solid var(--border-subtle)',
      }}
    />
  </label>
)

/**
 * Renders an error the way the project rules demand: the translated cause, plus the
 * technical context when we have it. Never a bare "something went wrong".
 */
export const ErrorNote = ({
  message,
  detail,
}: {
  readonly message: string
  readonly detail?: string | undefined
}): React.JSX.Element => (
  <div className="rounded-xl px-3.5 py-3 text-sm" style={{ background: 'var(--danger-soft)' }}>
    <p style={{ color: 'var(--danger)' }}>{message}</p>
    {detail !== undefined && detail.length > 0 && (
      <p className="mt-1 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
        {detail}
      </p>
    )}
  </div>
)

export const Badge = ({
  children,
  tone = 'neutral',
}: {
  readonly children: React.ReactNode
  readonly tone?: 'neutral' | 'success'
}): React.JSX.Element => (
  <span
    className="rounded-full px-2 py-0.5 text-xs font-medium"
    style={
      tone === 'success'
        ? { background: 'var(--success-soft)', color: 'var(--success)' }
        : { background: 'var(--surface-sunken)', color: 'var(--text-muted)' }
    }
  >
    {children}
  </span>
)

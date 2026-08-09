interface ButtonProps {
  readonly children: React.ReactNode
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly variant?: 'primary' | 'secondary' | 'danger'
  readonly type?: 'button' | 'submit'
  readonly title?: string
  readonly className?: string
  /**
   * `data-*` attributes, passed through to the real `<button>`.
   *
   * 🔴 They used to be dropped in silence, and TypeScript cannot catch it: JSX attribute
   * names containing a hyphen are exempt from excess-property checking, so
   * `<Button data-action="sign-out">` type-checks against a props type that has no such
   * field and then renders a button without the attribute. Measured 2026-08-09 — a
   * verification scenario reported "the Tailscale panel offered no button", while the
   * screenshot taken seconds earlier showed three of them.
   *
   * Which is the familiar shape: a negative finding produced by my own instrument. The
   * screenshot was the positive control that caught it.
   */
  readonly [dataAttribute: `data-${string}`]: string | undefined
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, React.CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--accent-contrast)' },
  secondary: { background: 'var(--surface-sunken)', color: 'var(--text-strong)' },
  danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
}

/**
 * Keeps only the `data-*` keys, and drops everything else.
 *
 * 🔴 The rest object collects every prop that is not destructured above — including `style`.
 * Spreading it after `style={VARIANTS[variant]}` let a smuggled `style` win and render the
 * button without its variant colours. TypeScript does not stop that: the `data-${string}`
 * index signature only rejects unknown keys written literally in JSX, and an object spread
 * (`<Button {...rowProps}>`) is exempt from excess-property checking altogether.
 *
 * Filtering by prefix rather than reordering the spread, because reordering would only move
 * the problem: with `{...rest}` first, a smuggled `className` or `onClick` would be
 * overwritten silently instead — a prop that vanishes is as confusing as one that wins.
 * Here anything that is not a `data-` attribute simply never reaches the DOM, which is the
 * contract the props type already states.
 */
const dataOnly = (props: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(props).filter(
      ([key, value]) => key.startsWith('data-') && typeof value === 'string',
    ),
  ) as Record<string, string>

export const Button = ({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  type = 'button',
  title,
  className = '',
  ...rest
}: ButtonProps): React.JSX.Element => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`flex items-center justify-center gap-2 rounded-[999px] px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-55 ${className}`}
    style={VARIANTS[variant]}
    {...dataOnly(rest)}
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

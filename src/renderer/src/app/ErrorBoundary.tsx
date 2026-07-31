import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches a render-time error and shows it.
 *
 * This exists because of a measured failure: a single throw inside one component left the
 * whole window **blank** — no message, no console line the user would ever see, and the
 * startup verifier reported `visibleText: ''` with no clue why. A blank window reads as "the
 * app does not start", which sends everyone hunting in the wrong place.
 *
 * So: the message and the component stack go on screen. Ugly on purpose — this state should
 * be reported, not lived with. It is also written to `document.title`, so an automated tour
 * can pick it up without needing the DOM.
 */

interface State {
  readonly error: Error | null
  readonly componentStack: string
}

export class ErrorBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // console.error rather than swallowing: the renderer's console is captured by the
    // startup verifier, so this line ends up in the report of a failing run.
    console.error('[renderer] render failed', error, info.componentStack)
    this.setState({ error, componentStack: info.componentStack ?? '' })
  }

  override render(): ReactNode {
    const { error, componentStack } = this.state
    if (error === null) return this.props.children

    return (
      <div className="flex h-full flex-col gap-3 overflow-auto p-6" data-testid="render-error">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--danger)' }}>
          {/* Deliberately untranslated: the i18n layer may be the thing that broke, and a
              missing translation here would replace the error with a raw key. */}
          The interface failed to render
        </h1>
        <p className="font-mono text-sm">{error.message}</p>
        <pre
          className="overflow-auto rounded-xl p-3 font-mono text-xs"
          style={{ background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}
        >
          {error.stack ?? ''}
          {componentStack}
        </pre>
      </div>
    )
  }
}

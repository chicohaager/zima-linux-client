// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../Controls'

/**
 * The attribute pass-through, guarded.
 *
 * 🔴 This is here because of a real failure on 2026-08-09, and because TypeScript is
 * structurally unable to catch it: a JSX attribute whose name contains a hyphen is exempt
 * from excess-property checking, so `<Button data-action="sign-out">` compiles against a
 * props type that never had such a field — and then renders a `<button>` without it.
 *
 * The cost was not the missing attribute. It was that a verification scenario looked for
 * `[data-tailscale-use]`, found nothing, and reported "the Tailscale panel offered no
 * button" — a confident negative finding about the app, produced entirely by my own
 * instrument. Only a screenshot taken seconds earlier, showing three such buttons,
 * contradicted it.
 *
 * So the assertion is deliberately about the RENDERED DOM, not about the props object:
 * that is the level where the drop happened.
 */
describe('Button', () => {
  it('forwards data attributes to the rendered button', () => {
    render(
      <Button data-action="sign-out" data-tailscale-use="100.64.0.1">
        Abmelden
      </Button>,
    )

    const button = screen.getByRole('button')
    expect(button.getAttribute('data-action')).toBe('sign-out')
    expect(button.getAttribute('data-tailscale-use')).toBe('100.64.0.1')
  })

  it('still renders the ordinary props it always had', () => {
    render(
      <Button type="submit" title="Hinweis" className="mine" disabled>
        Anmelden
      </Button>,
    )

    const button = screen.getByRole('button')
    expect(button.getAttribute('type')).toBe('submit')
    expect(button.getAttribute('title')).toBe('Hinweis')
    expect(button.className).toContain('mine')
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  /**
   * The named props must not leak into the DOM as attributes of their own. Spreading a rest
   * object is exactly how `variant="secondary"` ends up as an unknown attribute plus a React
   * warning nobody reads.
   */
  it('does not leak component-only props onto the element', () => {
    render(<Button variant="secondary">Verwenden</Button>)

    const button = screen.getByRole('button')
    expect(button.hasAttribute('variant')).toBe(false)
  })

  /**
   * 🔴 A smuggled prop must not be able to overrule the variant styling.
   *
   * The rest object collects everything not destructured — including `style`. Spread after
   * `style={VARIANTS[variant]}`, a smuggled one wins and the button renders without its
   * colours. TypeScript cannot stop it: the `data-${string}` index signature only rejects
   * unknown keys written literally in JSX, and an object spread is exempt from
   * excess-property checking altogether — which is exactly how such a prop arrives.
   *
   * The cast models that spread: it is the shape a call site produces, not a shape anyone
   * would type out by hand.
   */
  it('keeps the variant styling when a foreign prop is smuggled in via a spread', () => {
    const smuggled = { style: { background: 'red' }, id: 'x' } as unknown as {
      'data-smuggled'?: string
    }
    render(
      <Button variant="danger" {...smuggled}>
        Entfernen
      </Button>,
    )

    const button = screen.getByRole('button')
    // The variant's own background survived …
    expect(button.style.background).toBe('var(--danger-soft)')
    // … and nothing that was not a data attribute reached the DOM.
    expect(button.hasAttribute('id')).toBe(false)
  })
})

/**
 * Renders the *shape* of a JSON answer: field names and types, never values.
 *
 * Two reasons it is values-free, and both are project rules:
 *
 *  - A measurement report gets pasted into documents and issues. A device's real file
 *    names, share names and addresses are private data, so they must not travel with the
 *    measurement (project rule "nothing shareable carries private data").
 *  - The thing being measured is the contract, not the content. A report full of values
 *    invites reading a sample as if it were the schema.
 *
 * Arrays collapse to `[n × <shape of first element>]` so a list of 4000 photos stays one
 * line while still proving what an element looks like. The element count is kept because
 * "the list was empty" and "the list had items" are different measurements.
 */

const MAX_DEPTH = 6

const scalar = (value: unknown): string => {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      // `eyJ` is base64 for `{"`, so it marks a base64-encoded JSON document: a JWT, or a
      // pagination cursor, or anything else of that family. Labelled for what is actually
      // observable rather than as "jwt" — the gallery's `next_cursor` matched this prefix
      // and would have been reported as a leaked token.
      return value.startsWith('eyJ')
        ? `base64-json(len=${value.length})`
        : `string(len=${value.length})`
    case 'number':
      return Number.isInteger(value) ? 'int' : 'float'
    case 'boolean':
      return 'bool'
    default:
      return typeof value
  }
}

export const shapeOf = (value: unknown, depth = 0): unknown => {
  if (depth >= MAX_DEPTH) return '…'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[0]'
    return { [`[${value.length}]`]: shapeOf(value[0], depth + 1) }
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    // Sorted so two runs produce a comparable report; an unsorted object diff reads as a
    // change when only the key order moved.
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = shapeOf((value as Record<string, unknown>)[key], depth + 1)
    }
    return out
  }
  return scalar(value)
}

/**
 * One-line rendering of an ALREADY shaped value: `{a:int, b:bool}`.
 *
 * Takes the shape, not the payload, on purpose. The first version of this function called
 * `shapeOf` itself, and the caller passed the shape it had just computed — so every
 * `"bool"` came out as `string(len=4)`. A rendering of a rendering, and the console line
 * quietly described the wrong thing while the stored report was right.
 */
export const renderShape = (shape: unknown, limit = 300): string => {
  const text = JSON.stringify(shape).replaceAll('"', '').replaceAll(',', ', ')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

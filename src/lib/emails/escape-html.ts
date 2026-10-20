/**
 * Escapes HTML-significant characters so free text (breach-time prose, an
 * address a user typed) cannot break an email's markup. A stray `<`, `>`, `&`
 * or `"` would otherwise corrupt the rendered HTML. Plain-text bodies need no
 * escaping.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

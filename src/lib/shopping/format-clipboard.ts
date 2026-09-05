/**
 * Plain-text serialisation of the shopping list for the clipboard.
 *
 * Deliberately free of `next-intl`: every string arrives pre-translated and
 * pre-counted from the call site, which keeps this function locale-agnostic and
 * trivially unit-testable.
 *
 * It also cannot live in `@/lib/meal-planning/shopping-list` — that module
 * imports `@/lib/prisma` and is server-only, so importing it from the
 * `'use client'` shopping section would pull Prisma toward the client bundle.
 */

export interface ClipboardSection {
  /** Section heading, already translated and counted. `null` renders no heading (alphabetical mode). */
  heading: string | null
  /** Item labels without the `- ` prefix, in display order. */
  lines: string[]
}

/**
 * Render `title` plus each non-empty section as `- ` bullets, one blank line
 * between blocks and no trailing newline. `- ` is what Apple Notes, Google
 * Keep, and most messaging apps turn into a list on paste; `•` and `[ ]` are not.
 *
 * Returns `''` when no section has any lines — defensive, since the caller
 * hides the copy button in that state.
 */
export function formatShoppingListForClipboard(
  title: string,
  sections: ClipboardSection[],
): string {
  const blocks = sections
    .filter((section) => section.lines.length > 0)
    .map((section) => {
      const body = section.lines.map((line) => `- ${line}`).join('\n')
      return section.heading === null ? body : `${section.heading}\n${body}`
    })

  if (blocks.length === 0) return ''

  return [title, ...blocks].join('\n\n')
}

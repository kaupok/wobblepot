// Vitest 5 made Browser Mode's `toHaveTextContent` an exact match and typed it
// `string | number` (partial and RegExp matches moved to `toMatchTextContent`).
// Those types reach every file here through `vitest.config.ts` →
// `@vitest/browser-playwright`, and they shadow jest-dom's own signature:
// `@testing-library/jest-dom@7.0.1` still augments the one-parameter
// `Assertion<T>` that Vitest 5 replaced with `Assertion<R, T>`.
//
// The unit project runs jest-dom's matcher in jsdom (`vitest.setup.ts`), which
// takes a RegExp and matches partially, so this restores that signature. It
// does not change Browser Mode: `expect.element(...)` is unused here, and a
// regex check there belongs in `toMatchTextContent`.
import 'vitest'

declare module 'vitest' {
  interface Assertion<R, _T> {
    toHaveTextContent(text: string | number | RegExp, options?: { normalizeWhitespace: boolean }): R
  }
}

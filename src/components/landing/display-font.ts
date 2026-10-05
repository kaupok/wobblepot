import { Bricolage_Grotesque } from 'next/font/google'

/**
 * Bricolage Grotesque, the wordmark's face, as the landing page's display face
 * (docs/DESIGN.md → Primitives, Fonts; HON-1043) and the cook view's meal
 * name (`MealDetailModal`). Read through `Heading face="brand"`, which sets
 * `font-display`; the app's other headings stay Geist.
 *
 * Declared here rather than in `src/app/layout.tsx`, so it is set only on the
 * elements that use it. `preload: false` because signed-in Today renders on the same route
 * (`/`): a preload link would fetch the file there too. Without one, the
 * browser fetches it only once an element uses the face.
 *
 * `latin-ext` carries š and ž for Estonian. `opsz` follows the font size
 * (`font-optical-sizing: auto`), so a heading gets the display cut.
 */
export const displayFont = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz', 'wdth'],
  display: 'swap',
  preload: false,
})

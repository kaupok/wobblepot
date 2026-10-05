import { Geist, Geist_Mono } from 'next/font/google'

// Shared by the root layout and `global-error.tsx`, which renders its own
// document in place of the layout (HON-1047).
//
// The variable classes go on `<html>`, not `<body>`: Tailwind resolves
// `--default-font-family: var(--font-geist-sans)` at `:root`, so a variable
// defined only on `body` leaves `html` on the system font stack, and `body`
// inherits it (HON-1045). `latin-ext` carries the Estonian š and ž.
export const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin', 'latin-ext'],
})

export const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

import * as addonA11yAnnotations from '@storybook/addon-a11y/preview'
import { setProjectAnnotations } from '@storybook/nextjs-vite'
import { page } from '@vitest/browser/context'
import { beforeAll } from 'vitest'
import * as previewAnnotations from './preview'

// Mobile-first default; matches `.storybook/preview.tsx` → `initialGlobals.viewport`.
const DEFAULT_VIEWPORT = { width: 390, height: 844 }

interface ViewportStyles {
  width: string
  height: string
}

interface ViewportEntry {
  styles: ViewportStyles
}

function parsePx(value: string): number | null {
  const match = /^(\d+)px$/.exec(value)
  return match ? Number(match[1]) : null
}

function resolveViewportSize(
  viewportName: string | undefined,
  viewportOptions: Record<string, ViewportEntry> | undefined,
): { width: number; height: number } {
  if (!viewportName || !viewportOptions) return DEFAULT_VIEWPORT
  const entry = viewportOptions[viewportName]
  if (!entry) return DEFAULT_VIEWPORT
  const width = parsePx(entry.styles.width)
  const height = parsePx(entry.styles.height)
  if (width === null || height === null) return DEFAULT_VIEWPORT
  return { width, height }
}

// Per-story viewport sync for the Vitest browser page. The Storybook viewport
// addon resizes the preview iframe at Storybook dev time, but cannot resize the
// underlying Playwright page that @storybook/addon-vitest drives. Reading the
// story's resolved globals and calling `page.viewport(...)` keeps mobile-only
// components like MobileNav (`md:hidden`) and desktop-only chrome like
// NavigationLeft (`hidden md:flex`) rendering at the viewport their stories
// declare, rather than whatever Playwright's default is.
//
// Registered as a Vitest-only project annotation so it never runs in Storybook
// dev (where @vitest/browser/context is not available).
const vitestViewportSync = {
  beforeEach: async (context: {
    globals?: Record<string, unknown>
    parameters?: { viewport?: { options?: Record<string, ViewportEntry> } }
  }) => {
    const vp = context.globals?.viewport
    const viewportName = typeof vp === 'string' ? vp : (vp as { value?: string } | undefined)?.value
    const viewportOptions = context.parameters?.viewport?.options
    const size = resolveViewportSize(viewportName, viewportOptions)
    await page.viewport(size.width, size.height)
  },
}

// `@storybook/addon-a11y/preview` wires the axe runner that respects
// `parameters.a11y: { test: 'error' }`. Storybook auto-applies this when no
// setup file is present; we lose auto-apply by registering our own hooks, so
// include it explicitly here to preserve the a11y gate.
const annotations = setProjectAnnotations([
  addonA11yAnnotations,
  previewAnnotations,
  vitestViewportSync,
])

beforeAll(annotations.beforeAll)

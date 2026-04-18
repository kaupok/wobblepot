import type { TestRunnerConfig } from '@storybook/test-runner'
import { getStoryContext } from '@storybook/test-runner'

/**
 * Per-story viewport sync for Playwright.
 *
 * Storybook's `initialGlobals.viewport` and per-story `globals.viewport` only
 * resize the preview iframe — they do not resize the Playwright page the
 * test-runner drives. Without this, mobile-only components like `MobileNav`
 * (hidden at `md:` and up) appear as `display: none` at the test-runner's
 * default 1280px viewport and their triggers become inaccessible.
 *
 * We read each story's resolved viewport from its story context and map it to
 * a Playwright viewport size before the story is visited.
 */

interface ViewportStyles {
  width: string
  height: string
}

interface ViewportEntry {
  styles: ViewportStyles
}

// Mobile-first default; matches `.storybook/preview.tsx` → `initialGlobals.viewport`.
const DEFAULT_VIEWPORT = { width: 390, height: 844 }

function parsePx(value: string): number | null {
  const match = /^(\d+)px$/.exec(value)
  return match ? Number(match[1]) : null
}

function resolveViewportSize(
  viewportName: string | undefined,
  viewportOptions: Record<string, ViewportEntry> | undefined,
): { width: number; height: number } {
  if (!viewportName || !viewportOptions) {
    return DEFAULT_VIEWPORT
  }
  const entry = viewportOptions[viewportName]
  if (!entry) {
    return DEFAULT_VIEWPORT
  }
  const width = parsePx(entry.styles.width)
  const height = parsePx(entry.styles.height)
  if (width === null || height === null) {
    return DEFAULT_VIEWPORT
  }
  return { width, height }
}

const config: TestRunnerConfig = {
  async preVisit(page, context) {
    const storyContext = await getStoryContext(page, context)
    const storyGlobals = (storyContext as { globals?: Record<string, unknown> }).globals
    const initialGlobals = (storyContext as { initialGlobals?: Record<string, unknown> })
      .initialGlobals
    const viewportGlobal = storyGlobals?.viewport ?? initialGlobals?.viewport
    const viewportName =
      typeof viewportGlobal === 'string'
        ? viewportGlobal
        : (viewportGlobal as { value?: string } | undefined)?.value
    const viewportOptions = storyContext.parameters?.viewport?.options as
      | Record<string, ViewportEntry>
      | undefined
    const size = resolveViewportSize(viewportName, viewportOptions)
    await page.setViewportSize(size)
  },
}

export default config

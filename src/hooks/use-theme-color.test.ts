/* eslint-disable testing-library/no-node-access */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { UseThemeProps } from 'next-themes'
import { useThemeColor } from './use-theme-color'

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

describe('useThemeColor', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Remove any existing theme-color meta tag
    const existing = document.querySelector('meta[name="theme-color"]')
    if (existing) {
      existing.remove()
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Clean up meta tags after each test
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.remove()
    }
  })

  it('creates meta theme-color tag after mount', async () => {
    const { useTheme } = await import('next-themes')
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      systemTheme: 'light',
    } as ReturnType<typeof useTheme>)

    renderHook(() => useThemeColor())

    await waitFor(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      expect(meta).toBeTruthy()
      expect(meta?.getAttribute('content')).toBe('#ffffff')
    })
  })

  it('updates theme-color to white for light theme', async () => {
    const { useTheme } = await import('next-themes')
    vi.mocked(useTheme).mockReturnValue({
      theme: 'light',
      systemTheme: 'light',
    } as ReturnType<typeof useTheme>)

    renderHook(() => useThemeColor())

    await waitFor(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      expect(meta?.getAttribute('content')).toBe('#ffffff')
    })
  })

  it('updates theme-color to dark for dark theme', async () => {
    const { useTheme } = await import('next-themes')
    vi.mocked(useTheme).mockReturnValue({
      theme: 'dark',
      systemTheme: 'dark',
    } as ReturnType<typeof useTheme>)

    renderHook(() => useThemeColor())

    await waitFor(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      expect(meta?.getAttribute('content')).toBe('#1a1a1a')
    })
  })

  it('respects system theme when theme is set to system', async () => {
    const { useTheme } = await import('next-themes')
    vi.mocked(useTheme).mockReturnValue({
      theme: 'system',
      systemTheme: 'dark',
    } as ReturnType<typeof useTheme>)

    renderHook(() => useThemeColor())

    await waitFor(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      expect(meta?.getAttribute('content')).toBe('#1a1a1a')
    })
  })

  it('defaults to light theme color when theme is undefined', async () => {
    const { useTheme } = await import('next-themes')
    vi.mocked(useTheme).mockReturnValue({
      theme: undefined,
      systemTheme: undefined,
    } as ReturnType<typeof useTheme>)

    renderHook(() => useThemeColor())

    await waitFor(() => {
      const meta = document.querySelector('meta[name="theme-color"]')
      expect(meta?.getAttribute('content')).toBe('#ffffff')
    })
  })

  it('handles theme changes gracefully', async () => {
    const { useTheme } = await import('next-themes')
    const mockUseTheme = vi.mocked(useTheme)

    mockUseTheme.mockReturnValue({
      theme: 'light',
      systemTheme: 'light',
    } as ReturnType<typeof useTheme>)

    const { rerender } = renderHook(() => useThemeColor())

    await waitFor(() => {
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
        '#ffffff',
      )
    })

    // Simulate theme change
    mockUseTheme.mockReturnValue({
      theme: 'dark',
      systemTheme: 'dark',
    } as ReturnType<typeof useTheme>)

    rerender()

    await waitFor(() => {
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
        '#1a1a1a',
      )
    })
  })
})

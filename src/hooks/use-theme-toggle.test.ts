import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTheme } from 'next-themes'
import { useThemeToggle } from './use-theme-toggle'

vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

const mockSetTheme = vi.fn()

function mockResolvedTheme(resolvedTheme: string | undefined) {
  vi.mocked(useTheme).mockReturnValue({
    resolvedTheme,
    setTheme: mockSetTheme,
  } as unknown as ReturnType<typeof useTheme>)
}

describe('useThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers dark mode while the resolved theme is light', () => {
    mockResolvedTheme('light')
    const { result } = renderHook(() => useThemeToggle())

    expect(result.current.isDark).toBe(false)
    expect(result.current.label).toBe('Dark mode')
  })

  it('offers light mode while the resolved theme is dark', () => {
    mockResolvedTheme('dark')
    const { result } = renderHook(() => useThemeToggle())

    expect(result.current.isDark).toBe(true)
    expect(result.current.label).toBe('Light mode')
  })

  it('switches to the opposite of the resolved theme', () => {
    mockResolvedTheme('dark')
    const { result } = renderHook(() => useThemeToggle())

    result.current.toggle()
    expect(mockSetTheme).toHaveBeenCalledWith('light')

    mockResolvedTheme('light')
    const { result: light } = renderHook(() => useThemeToggle())
    light.current.toggle()
    expect(mockSetTheme).toHaveBeenLastCalledWith('dark')
  })
})

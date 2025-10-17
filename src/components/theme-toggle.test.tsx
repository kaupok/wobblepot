import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as nextThemes from 'next-themes'
import { ThemeToggle } from './theme-toggle'

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

const mockUseTheme = vi.mocked(nextThemes.useTheme)

interface MockTheme {
  theme: string | undefined
  setTheme: ReturnType<typeof vi.fn>
  systemTheme: 'light' | 'dark' | undefined
  themes: string[]
  resolvedTheme?: string
}

const createMockTheme = (
  theme: string | undefined,
  setTheme: ReturnType<typeof vi.fn> = vi.fn(),
): MockTheme => ({
  theme,
  setTheme,
  systemTheme: 'light' as const,
  themes: [],
  resolvedTheme: theme,
})

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders button with accessible label', () => {
    mockUseTheme.mockReturnValue(createMockTheme('light'))

    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Toggle theme' })
    expect(button).toBeInTheDocument()
  })

  it('renders with outline variant and icon size', () => {
    mockUseTheme.mockReturnValue(createMockTheme('light'))

    render(<ThemeToggle />)
    const button = screen.getByRole('button')
    expect(button).toHaveClass('relative')
  })

  it('shows fallback monitor icon before hydration', () => {
    mockUseTheme.mockReturnValue(createMockTheme(undefined))

    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Toggle theme' })
    expect(button).toBeInTheDocument()
  })

  it('calls setTheme with correct values when clicking', () => {
    const mockSetTheme = vi.fn()
    mockUseTheme.mockReturnValue(createMockTheme('light', mockSetTheme))

    render(<ThemeToggle />)
    const button = screen.getByRole('button')
    button.click()

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('cycles through all three theme states', () => {
    const mockSetTheme = vi.fn()

    // System -> Light
    mockUseTheme.mockReturnValue(createMockTheme('system', mockSetTheme))

    const { rerender } = render(<ThemeToggle />)
    screen.getByRole('button', { name: 'Toggle theme' }).click()
    expect(mockSetTheme).toHaveBeenCalledWith('light')

    // Light -> Dark
    mockSetTheme.mockClear()
    mockUseTheme.mockReturnValue(createMockTheme('light', mockSetTheme))
    rerender(<ThemeToggle />)
    screen.getByRole('button', { name: 'Toggle theme' }).click()
    expect(mockSetTheme).toHaveBeenCalledWith('dark')

    // Dark -> System
    mockSetTheme.mockClear()
    mockUseTheme.mockReturnValue(createMockTheme('dark', mockSetTheme))
    rerender(<ThemeToggle />)
    screen.getByRole('button', { name: 'Toggle theme' }).click()
    expect(mockSetTheme).toHaveBeenCalledWith('system')
  })
})

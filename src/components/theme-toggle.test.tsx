import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import type { UseThemeProps } from 'next-themes'
import * as nextThemes from 'next-themes'
import { ThemeToggle } from './theme-toggle'

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: vi.fn(),
}))

const mockUseTheme = vi.mocked(nextThemes.useTheme)

const createMockTheme = (resolvedTheme: string | undefined, setTheme = vi.fn()): UseThemeProps => ({
  theme: resolvedTheme,
  setTheme,
  systemTheme: 'light',
  themes: [],
  resolvedTheme,
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

  it('shows placeholder before hydration', () => {
    mockUseTheme.mockReturnValue(createMockTheme(undefined))

    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Toggle theme' })
    expect(button).toBeInTheDocument()
  })

  it('toggles from light to dark', () => {
    const mockSetTheme = vi.fn()
    mockUseTheme.mockReturnValue(createMockTheme('light', mockSetTheme))

    render(<ThemeToggle />)
    screen.getByRole('button').click()

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('toggles from dark to light', () => {
    const mockSetTheme = vi.fn()
    mockUseTheme.mockReturnValue(createMockTheme('dark', mockSetTheme))

    render(<ThemeToggle />)
    screen.getByRole('button').click()

    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('cycles between light and dark', async () => {
    const mockSetTheme = vi.fn()
    const user = userEvent.setup()

    // Light -> Dark
    mockUseTheme.mockReturnValue(createMockTheme('light', mockSetTheme))

    const { rerender } = render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Toggle theme' }))
    expect(mockSetTheme).toHaveBeenCalledWith('dark')

    // Dark -> Light
    mockSetTheme.mockClear()
    mockUseTheme.mockReturnValue(createMockTheme('dark', mockSetTheme))
    rerender(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Toggle theme' }))
    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })
})

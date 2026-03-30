import { describe, it, expect } from 'vitest'
import { cn, getValidReturnUrl } from './utils'

describe('cn utility function', () => {
  it('merges multiple class names', () => {
    const result = cn('class-1', 'class-2', 'class-3')
    expect(result).toBe('class-1 class-2 class-3')
  })

  it('handles undefined and null values', () => {
    const result = cn('class-1', undefined, 'class-2', null, 'class-3')
    expect(result).toBe('class-1 class-2 class-3')
  })

  it('handles falsy values', () => {
    const result = cn('class-1', false && 'class-2', 'class-3')
    expect(result).toBe('class-1 class-3')
  })

  it('handles conditional classes', () => {
    const isActive = true
    const isDisabled = false
    const result = cn('base', isActive && 'active', isDisabled && 'disabled')
    expect(result).toBe('base active')
  })

  it('handles arrays of classes', () => {
    const result = cn(['class-1', 'class-2'], 'class-3')
    expect(result).toBe('class-1 class-2 class-3')
  })

  it('handles objects with boolean values', () => {
    const result = cn({
      'class-1': true,
      'class-2': false,
      'class-3': true,
    })
    expect(result).toBe('class-1 class-3')
  })

  it('merges Tailwind conflicting classes correctly', () => {
    // tailwind-merge should keep the last conflicting class
    const result = cn('px-2 py-1', 'px-4')
    expect(result).toBe('py-1 px-4')
  })

  it('handles complex Tailwind class conflicts', () => {
    const result = cn('text-sm font-bold', 'text-lg')
    expect(result).toBe('font-bold text-lg')
  })

  it('preserves non-conflicting Tailwind classes', () => {
    const result = cn('bg-blue-500 text-white', 'hover:bg-blue-600')
    expect(result).toBe('bg-blue-500 text-white hover:bg-blue-600')
  })

  it('handles empty inputs', () => {
    const result = cn()
    expect(result).toBe('')
  })

  it('handles only falsy values', () => {
    const result = cn(undefined, null, false)
    expect(result).toBe('')
  })

  it('handles mixed input types', () => {
    const result = cn(
      'base-class',
      ['array-class-1', 'array-class-2'],
      {
        'object-class-1': true,
        'object-class-2': false,
      },
      undefined,
      'another-class',
    )
    expect(result).toBe('base-class array-class-1 array-class-2 object-class-1 another-class')
  })

  it('handles responsive Tailwind classes', () => {
    const result = cn('text-sm md:text-base lg:text-lg')
    expect(result).toBe('text-sm md:text-base lg:text-lg')
  })

  it('handles pseudo-class modifiers', () => {
    const result = cn('hover:bg-blue-500', 'focus:bg-blue-600', 'active:bg-blue-700')
    expect(result).toBe('hover:bg-blue-500 focus:bg-blue-600 active:bg-blue-700')
  })

  it('resolves dark mode class conflicts', () => {
    const result = cn('bg-white dark:bg-gray-800', 'dark:bg-gray-900')
    expect(result).toBe('bg-white dark:bg-gray-900')
  })

  describe('real-world usage scenarios', () => {
    it('handles button variant classes', () => {
      const baseClasses = 'inline-flex items-center justify-center rounded-md'
      const variantClasses = 'bg-primary text-primary-foreground'
      const customClasses = 'my-custom-class'

      const result = cn(baseClasses, variantClasses, customClasses)
      expect(result).toContain('inline-flex')
      expect(result).toContain('bg-primary')
      expect(result).toContain('my-custom-class')
    })

    it('handles conditional state classes', () => {
      const isLoading = true
      const isDisabled = false

      const result = cn(
        'button',
        isLoading && 'opacity-50 cursor-wait',
        isDisabled && 'opacity-50 cursor-not-allowed',
      )
      expect(result).toBe('button opacity-50 cursor-wait')
    })

    it('overrides default padding with custom padding', () => {
      const defaultClasses = 'px-4 py-2'
      const customClasses = 'px-6'

      const result = cn(defaultClasses, customClasses)
      expect(result).toBe('py-2 px-6')
    })
  })
})

describe('getValidReturnUrl', () => {
  const DEFAULT_REDIRECT = '/'

  describe('valid inputs', () => {
    it('returns valid relative path unchanged', () => {
      expect(getValidReturnUrl('/meal-plan')).toBe('/meal-plan')
    })

    it('returns nested paths unchanged', () => {
      expect(getValidReturnUrl('/household/household')).toBe('/household/household')
    })

    it('returns paths with query params unchanged', () => {
      expect(getValidReturnUrl('/search?q=test')).toBe('/search?q=test')
    })

    it('returns root path unchanged', () => {
      expect(getValidReturnUrl('/')).toBe('/')
    })
  })

  describe('null and empty inputs', () => {
    it('returns default for null', () => {
      expect(getValidReturnUrl(null)).toBe(DEFAULT_REDIRECT)
    })

    it('returns default for empty string', () => {
      expect(getValidReturnUrl('')).toBe(DEFAULT_REDIRECT)
    })
  })

  describe('open redirect prevention', () => {
    it('rejects absolute URLs with https', () => {
      expect(getValidReturnUrl('https://evil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects absolute URLs with http', () => {
      expect(getValidReturnUrl('http://evil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects protocol-relative URLs', () => {
      expect(getValidReturnUrl('//evil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects URLs not starting with /', () => {
      expect(getValidReturnUrl('evil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects javascript: URLs', () => {
      expect(getValidReturnUrl('javascript:alert(1)')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects URLs with backslashes', () => {
      expect(getValidReturnUrl('/\\evil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects encoded protocol-relative URLs', () => {
      // %2F is encoded /
      expect(getValidReturnUrl('/%2F/evil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects encoded backslash attacks', () => {
      // %5C is encoded \
      expect(getValidReturnUrl('/%5Cevil.com')).toBe(DEFAULT_REDIRECT)
    })

    it('rejects malformed encoded URLs', () => {
      // Invalid percent encoding
      expect(getValidReturnUrl('/%ZZ/invalid')).toBe(DEFAULT_REDIRECT)
    })
  })
})

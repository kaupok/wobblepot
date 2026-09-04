import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CUSTOM_SPACING_VALUES, cn, getValidReturnUrl, prefersReducedMotion } from './utils'

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

  // `touch` is a project spacing value, not a Tailwind built-in, so
  // tailwind-merge has to be told about it (see the `extendTailwindMerge` call
  // in utils.ts). Untold, it treats `h-touch` as an unknown class and keeps
  // both sides of a height conflict, which silently defeats every callsite
  // that overrides a control's height.
  describe('the touch spacing value', () => {
    it('overrides a numeric height', () => {
      expect(cn('h-8', 'h-touch')).toBe('h-touch')
      expect(cn('min-h-9', 'min-h-touch')).toBe('min-h-touch')
    })

    // Only below `md`, and that asymmetry is the point. The responsive half of
    // the pair carries a different modifier, so it survives the merge, and
    // Tailwind emits every `md:` utility in one media block after the base
    // ones at equal specificity — so it wins at >=768px. A callsite `h-7` on a
    // default Button is 28px on a phone and 36px on a desktop. Callsites that
    // need one fixed height must pick a variant without a breakpoint
    // (`sm` / `icon-sm`), not override the height with a className.
    it('is overridden by a numeric height below md only', () => {
      expect(cn('h-touch md:h-9', 'h-7')).toBe('md:h-9 h-7')
      expect(cn('min-h-touch md:min-h-9', 'min-h-9')).toBe('md:min-h-9 min-h-9')
      // No breakpoint on either side, so this one is a complete override.
      expect(cn('size-touch', 'size-8')).toBe('size-8')
    })

    it('keeps the mobile and md halves of a responsive pair', () => {
      expect(cn('h-touch md:h-9')).toBe('h-touch md:h-9')
      expect(cn('h-touch md:h-9', 'md:h-10')).toBe('h-touch md:h-10')
    })
  })

  // The guard for the bug above, rather than one more example of it. HON-609
  // declared `--spacing-touch` without registering it; the break stayed latent
  // for a day and only surfaced once HON-612 sized real controls with the
  // token. This fails the moment the two lists drift, not once something
  // consumes the token (HON-626).
  describe('custom spacing registration', () => {
    // Resolved from this file rather than `process.cwd()`, so the guard does
    // not depend on where vitest was invoked from. Built with `join` and not
    // `new URL(…, import.meta.url)`: Vite statically rewrites that form into an
    // asset URL, which comes back `http://` and blows up `fileURLToPath`.
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')

    /**
     * Every custom `--spacing-*` value declared in an `@theme` block anywhere
     * under `src/`.
     *
     * Globbed rather than pointed at `globals.css`, because a second stylesheet
     * with its own `@theme` block would otherwise pass unnoticed — and passing
     * unnoticed is the exact failure mode this guard exists to catch. Scoped to
     * `@theme` because only those declarations become theme variables and
     * generate utilities in Tailwind v4; a `--spacing-*` in `:root` generates
     * nothing, so it can conflict with nothing.
     */
    function declaredSpacingValues(): string[] {
      const cssFiles = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter((file) =>
        file.endsWith('.css'),
      )

      expect(
        cssFiles,
        `No stylesheet found under ${srcDir}, so this guard would pass by reading nothing.`,
      ).not.toEqual([])

      const declared = new Set<string>()

      for (const file of cssFiles) {
        const css = readFileSync(join(srcDir, file), 'utf8')
          // Strip block comments so prose mentioning the utilities cannot
          // match. The token regex is anchored on the colon and would not match
          // them anyway; this is belt-and-braces.
          .replace(/\/\*[\s\S]*?\*\//g, '')

        // Declarations carry no braces, so a non-greedy run to the first `}` is
        // the whole block.
        for (const [, block = ''] of css.matchAll(/@theme[^{]*\{([^}]*)\}/g)) {
          for (const [, token = ''] of block.matchAll(/--spacing-([a-zA-Z0-9-]+)\s*:/g)) {
            declared.add(token)
          }
        }
      }

      return [...declared]
    }

    it('registers every --spacing-* token declared in a @theme block', () => {
      const declared = declaredSpacingValues()
      const registered = new Set<string>(CUSTOM_SPACING_VALUES)

      const missing = declared.filter((token) => !registered.has(token))
      expect(
        missing,
        `--spacing-${missing.join(', --spacing-')} is declared in a @theme block but not in CUSTOM_SPACING_VALUES in src/lib/utils.ts. Until it is registered, tailwind-merge keeps both sides of any conflict on that value (cn('h-8', 'h-${missing[0]}') returns both) and every className override of it silently stops working.`,
      ).toEqual([])

      // Behavioural, not a name comparison. A value registered under the wrong
      // tailwind-merge theme key — `space`, a `classGroups` entry, a typo —
      // satisfies the list diff above while still merging as if unregistered,
      // which is the same silent hole this guard exists to close.
      const unresolved = declared.filter((token) => cn('h-8', `h-${token}`) !== `h-${token}`)
      expect(
        unresolved,
        `tailwind-merge does not resolve ${unresolved.join(', ')} as a spacing value — cn('h-8', 'h-${unresolved[0]}') kept both classes. Register it in CUSTOM_SPACING_VALUES in src/lib/utils.ts, under extend.theme.spacing.`,
      ).toEqual([])

      const stale = [...registered].filter((token) => !declared.includes(token))
      expect(
        stale,
        `CUSTOM_SPACING_VALUES in src/lib/utils.ts lists ${stale.join(', ')}, which is no longer declared in any @theme block. Remove it.`,
      ).toEqual([])
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

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-reduced-motion')
  })

  it('returns false during SSR when window is undefined', () => {
    vi.stubGlobal('window', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('returns true when the Storybook data-reduced-motion attribute is set', () => {
    document.documentElement.setAttribute('data-reduced-motion', 'true')
    // matchMedia should not be consulted in this path, but stub it to prove we
    // don't depend on it.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    expect(prefersReducedMotion()).toBe(true)
  })

  it('returns true when the OS media query matches', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })),
    )
    expect(prefersReducedMotion()).toBe(true)
  })

  it('returns false when neither the attribute nor the media query matches', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    )
    expect(prefersReducedMotion()).toBe(false)
  })
})

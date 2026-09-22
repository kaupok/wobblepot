import { describe, expect, it } from 'vitest'
import { parseArgs, PROMPT_VARIANTS, renderContactSheet, variantPrompt } from './spike-meal-colour'
import { V3_PROMPT_SUFFIX } from './spike-meal-images'
import { DEFAULT_HUE_OPTIONS } from '../src/lib/meal-images/colour'
import { PROMPT_SUFFIX } from '../src/lib/meal-images/prompt'

describe('HON-743: meal colour spike', () => {
  it('parses args and rejects a bad limit', () => {
    expect(parseArgs(['--limit=3', '--source=x', '--draw=v4', '--confirm'])).toEqual({
      limit: 3,
      source: 'x',
      draw: ['v4'],
      confirm: true,
    })
    expect(() => parseArgs(['--draw=v9'])).toThrow('Unknown prompt variant')
    expect(() => parseArgs(['--limit=0'])).toThrow('--limit')
    expect(() => parseArgs(['--nope'])).toThrow('Unknown argument')
  })

  it('renders one section per meal with the hue on light and dark cards', () => {
    const hue = { hue: 120, chroma: 0.1, coverage: 0.5, opaque: 1, bins: new Array(18).fill(0) }
    const html = renderContactSheet(
      [
        { slug: 'a', name: 'A & B', images: [{ label: 'shipped', preview: 'a.webp', hue }] },
        {
          slug: 'b',
          name: 'B',
          images: [{ label: 'shipped', preview: 'b.webp', hue: { ...hue, hue: 30 } }],
        },
      ],
      { startedAt: 'now', options: DEFAULT_HUE_OPTIONS },
    )
    expect(html).toContain('A &amp; B')
    expect(html).toContain('--hue:30')
    // Two meals × (grid light, grid dark, section light, section dark).
    expect(html.match(/class="card (light|dark)"/g)).toHaveLength(8)
  })

  it('swaps only the suffix for a variant composition, on V3 and V4 prompts', () => {
    for (const shipped of ['Prefix. Body. ' + V3_PROMPT_SUFFIX, 'Prefix. Body. ' + PROMPT_SUFFIX]) {
      const v4 = variantPrompt(shipped, 'v4')
      expect(v4.startsWith('Prefix. Body. ')).toBe(true)
      expect(v4).not.toContain('filling the frame')
      expect(v4).not.toContain('pure white')
      expect(v4).toContain('about half the width')
    }
    expect(() => variantPrompt('no suffix here', 'v4')).toThrow('known suffix')
  })

  it('ships the v4-white variant as the production suffix', () => {
    expect(PROMPT_SUFFIX).toBe(PROMPT_VARIANTS['v4-white'])
  })
})

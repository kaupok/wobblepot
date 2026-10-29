import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'

// An MCP tool name (`plan_meal`) is a technical detail a household does not
// know, so no catalog string may contain one (HON-1470). The names are read
// from the tool sources, not imported, because the tools are `server-only`.
const TOOLS_DIR = join(__dirname, '../mcp/tools')

function toolNames(): string[] {
  const names = new Set<string>()
  for (const file of readdirSync(TOOLS_DIR)) {
    if (!file.endsWith('.ts') || file.includes('.test.') || file.includes('.fixtures.')) continue
    const source = readFileSync(join(TOOLS_DIR, file), 'utf8')
    for (const match of source.matchAll(/^\s+name: '([a-z]+(?:_[a-z]+)+)',$/gm)) {
      names.add(match[1]!)
    }
  }
  return [...names]
}

function strings(node: unknown, prefix = '', out: [string, string][] = []) {
  if (typeof node === 'string') out.push([prefix, node])
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      strings(value, prefix ? `${prefix}.${key}` : key, out)
    }
  }
  return out
}

describe('catalogue tool names', () => {
  const names = toolNames()

  it('reads the MCP tool names from their sources', () => {
    expect(names).toContain('plan_meal')
    expect(names).toContain('swap_meal')
    expect(names.length).toBeGreaterThanOrEqual(20)
  })

  it.each([
    ['en', enMessages],
    ['et', etMessages],
  ])('%s has no string that names an MCP tool', (_locale, messages) => {
    const offenders = strings(messages).filter(([, value]) =>
      names.some((name) => value.includes(name)),
    )
    expect(offenders).toEqual([])
  })
})

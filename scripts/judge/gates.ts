import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The `/judge` hard-gate matcher (HON-1514). It runs before any model call, so
 * an issue in a gated area is held without a subagent ever reading it. The gate
 * list lives in `.claude/skills/judge/gates.md`, in its one `json` block, so the
 * prose a human reads and the list this file matches cannot drift apart.
 */

export interface Gate {
  name: string
  labels: string[]
  paths: string[]
  keywords: string[]
}

export interface GateIssue {
  title: string
  description?: string | null
  labels?: string[]
}

export interface GateHit {
  gate: string
  kind: 'label' | 'path' | 'keyword'
  matched: string
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const GATES_FILE = path.join(repoRoot, '.claude', 'skills', 'judge', 'gates.md')

export function parseGates(markdown: string): Gate[] {
  const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)]
  if (blocks.length !== 1) {
    throw new Error(`gates.md must hold exactly one json block, found ${blocks.length}`)
  }
  const parsed: unknown = JSON.parse(blocks[0]?.[1] ?? '')
  if (!Array.isArray(parsed)) throw new Error('the gates.md json block must be an array')
  return parsed.map((raw: unknown, i) => {
    const gate = raw as Partial<Gate>
    const lists = [gate.labels, gate.paths, gate.keywords]
    if (
      typeof gate.name !== 'string' ||
      !lists.every((list) => Array.isArray(list) && list.every((v) => typeof v === 'string'))
    ) {
      throw new Error(`gate ${i} needs a name and string arrays for labels, paths and keywords`)
    }
    return gate as Gate
  })
}

export function loadGates(file: string = GATES_FILE): Gate[] {
  return parseGates(fs.readFileSync(file, 'utf8'))
}

// A path-like token holds at least one `/`. `:42` line suffixes stop the match.
const PATH_TOKEN = /[\w@.()[\]-]+(?:\/[\w@.()[\]*-]+)+/g

function trimToken(token: string): string {
  // A markdown link, "[src/x.ts](https://…)", keeps only the link text.
  let t = token
    .replace(/^\.\//, '')
    .replace(/^\[/, '')
    .replace(/\]\(.*$/, '')
  // A path written inside parentheses, "(src/x.ts)" or "(src/x.ts),", loses them.
  if (t.startsWith('(') && /\)[.,]?$/.test(t)) t = t.slice(1).replace(/\)([.,]?)$/, '$1')
  while (t.startsWith('(') && countOf(t, '(') > countOf(t, ')')) t = t.slice(1)
  while (/[.,)]$/.test(t) && (!t.endsWith(')') || countOf(t, ')') > countOf(t, '('))) {
    t = t.slice(0, -1)
  }
  return t
}

function countOf(text: string, char: string): number {
  return text.split(char).length - 1
}

// A GitHub permalink, ".../blob/main/prisma/schema.prisma", also yields its repository path.
const BLOB_PATH = /(?:^|\/)(?:blob|tree)\/[^/]+\/(.+)$/

export function extractPaths(text: string): string[] {
  const tokens = [...text.matchAll(PATH_TOKEN)].map((m) => trimToken(m[0]))
  return [...new Set(tokens.flatMap((t) => [t, ...(BLOB_PATH.exec(t)?.slice(1, 2) ?? [])]))]
}

export function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? ''
    if (char === '/' && glob.slice(i + 1) === '**') {
      // A trailing "/**" also matches the directory itself, "prisma/migrations/".
      source += '(?:/.*)?'
      break
    } else if (char === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/'
      source += slash ? '(?:.*/)?' : '.*'
      i += slash ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

function keywordRegExp(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w])${escaped}(?:s|es)?(?![\\w])`, 'i')
}

/** The first gate in list order that the issue hits, or null. */
export function matchGate(issue: GateIssue, gates: Gate[]): GateHit | null {
  const text = `${issue.title}\n${issue.description ?? ''}`
  const paths = extractPaths(text)
  const prose = text.replace(PATH_TOKEN, ' ')
  const labels = (issue.labels ?? []).map((l) => l.toLowerCase())

  for (const gate of gates) {
    const label = gate.labels.find((l) => labels.includes(l.toLowerCase()))
    if (label) return { gate: gate.name, kind: 'label', matched: label }
    for (const glob of gate.paths) {
      const re = globToRegExp(glob)
      const hit = paths.find((p) => re.test(p))
      if (hit) return { gate: gate.name, kind: 'path', matched: hit }
    }
    const keyword = gate.keywords.find((k) => keywordRegExp(k).test(prose))
    if (keyword) return { gate: gate.name, kind: 'keyword', matched: keyword }
  }
  return null
}

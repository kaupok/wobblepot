import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { type GateIssue, loadGates, matchGate } from './gates'
import { finalizeVerdict, gitReaders, type ListedIssue, selectIssues } from './verdict'

/**
 * `pnpm judge <command>`: the mechanical steps of the `/judge` skill
 * (`.claude/skills/judge/SKILL.md`). Each command reads JSON files and prints
 * JSON to stdout, so the skill never parses prose.
 *
 *   select   --issues <file> [--rejudge]   which listed issues to judge
 *   gate     --issue <file>                 the hard gate an issue hits, or null
 *   finalize --verdict <file> [--ref <sha>] [--linear-dir <dir>]
 *                                           verify citations, render comment and label
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const USAGE = `Usage:
  pnpm judge select --issues <file> [--rejudge]
  pnpm judge gate --issue <file>
  pnpm judge finalize --verdict <file> [--ref <sha>] [--linear-dir <dir>]`

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

function required(args: string[], name: string): string {
  const value = option(args, name)
  if (value === undefined) throw new Error(`${name} is required\n${USAGE}`)
  return value
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))

/** Linear returns labels as names or as `{ name }` objects, depending on the call. */
function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []
  return labels.map((l: unknown) =>
    typeof l === 'string' ? l : String((l as { name?: unknown }).name ?? ''),
  )
}

export function run(args: string[]): unknown {
  const [command, ...rest] = args
  switch (command) {
    case 'select': {
      const raw = readJson(required(rest, '--issues'))
      const list = (Array.isArray(raw) ? raw : (raw as { issues?: unknown }).issues) as
        ListedIssue[] | undefined
      if (!Array.isArray(list)) throw new Error('--issues must hold an array or { issues: [] }')
      return selectIssues(list, { rejudge: rest.includes('--rejudge') })
    }
    case 'gate': {
      const issue = readJson(required(rest, '--issue')) as GateIssue & { labels?: unknown }
      return { gate: matchGate({ ...issue, labels: labelNames(issue.labels) }, loadGates()) }
    }
    case 'finalize': {
      const verdict = readJson(required(rest, '--verdict'))
      const ref = option(rest, '--ref') ?? 'origin/main'
      const linearDir = option(rest, '--linear-dir')
      return finalizeVerdict(verdict, gitReaders(ref, linearDir, repoRoot))
    }
    default:
      throw new Error(USAGE)
  }
}

// Guarded so the tests can import `run` without running it.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  try {
    // eslint-disable-next-line no-console -- the CLI's output is its result
    console.log(JSON.stringify(run(process.argv.slice(2)), null, 2))
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- the CLI reports its own failure
    console.error(`judge: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

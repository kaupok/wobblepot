import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { type GateIssue, loadGates, matchGate } from './gates'
import {
  fetchCitedText,
  fetchIssue,
  linearClient,
  type LinearDeps,
  listAutoDrafts,
  listOne,
} from './linear'
import {
  citationTarget,
  finalizeVerdict,
  gitReaders,
  type ListedIssue,
  selectIssues,
  validateVerdict,
} from './verdict'

/**
 * `pnpm judge <command>`: the mechanical steps of the `/judge` skill
 * (`.claude/skills/judge/SKILL.md`). Each command reads JSON files and prints
 * JSON to stdout, so the skill never parses prose. `list`, `issue` and `cite`
 * read Linear with `LINEAR_API_KEY`, so the session copies no Linear text by hand.
 *
 *   list     --out <file> [--id <ID>]       open [AUTO DRAFT] issues (or one), the shape select reads
 *   issue    --id <ID> --out <file>         one issue, the shape gate reads
 *   select   --issues <file> [--rejudge]   which listed issues to judge
 *   gate     --issue <file>                 the hard gate an issue hits, or null
 *   cite     --verdict <file> --linear-dir <dir> [--before <ISO date>]
 *                                           write each cited issue's text for finalize
 *   finalize --verdict <file> [--ref <sha>] [--linear-dir <dir>]
 *                                           verify citations, render comment and label
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const USAGE = `Usage:
  pnpm judge list --out <file> [--id <ID>]
  pnpm judge issue --id <ID> --out <file>
  pnpm judge select --issues <file> [--rejudge]
  pnpm judge gate --issue <file>
  pnpm judge cite --verdict <file> --linear-dir <dir> [--before <ISO date>]
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

const writeJson = (file: string, value: unknown) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

const defaultDeps: LinearDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  env: process.env,
  envFile: path.join(repoRoot, '.env'),
}

export async function run(args: string[], deps: LinearDeps = defaultDeps): Promise<unknown> {
  const [command, ...rest] = args
  switch (command) {
    case 'list': {
      const out = required(rest, '--out')
      const id = option(rest, '--id')
      const query = linearClient(deps)
      const issues = id === undefined ? await listAutoDrafts(query) : await listOne(query, id)
      writeJson(out, issues)
      return { out, ids: issues.map((i) => i.id) }
    }
    case 'issue': {
      const id = required(rest, '--id')
      const out = required(rest, '--out')
      writeJson(out, await fetchIssue(linearClient(deps), id))
      return { out, id }
    }
    case 'cite': {
      const verdict = validateVerdict(readJson(required(rest, '--verdict')))
      const dir = required(rest, '--linear-dir')
      const before = option(rest, '--before')
      if (before !== undefined && Number.isNaN(Date.parse(before))) {
        throw new Error('--before needs an ISO date')
      }
      // Linear returns ISO strings in UTC, so this form compares as text.
      const beforeIso = before === undefined ? undefined : new Date(before).toISOString()
      const ids = new Set(
        verdict.citations
          .map((c) => citationTarget(c.source))
          .filter((t) => t.kind === 'linear')
          .map((t) => t.id),
      )
      if (verdict.duplicateOf) ids.add(verdict.duplicateOf)
      ids.delete(verdict.issue)
      const query = linearClient(deps)
      fs.mkdirSync(dir, { recursive: true })
      const written: string[] = []
      const skipped: { id: string; reason: string }[] = []
      for (const id of ids) {
        const text = await fetchCitedText(query, id, beforeIso)
        if (text === null) {
          skipped.push({ id, reason: `created after ${before}` })
          continue
        }
        fs.writeFileSync(path.join(dir, `${id}.txt`), text)
        written.push(id)
      }
      return { written, skipped }
    }
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
  run(process.argv.slice(2)).then(
    (result) => {
      // eslint-disable-next-line no-console -- the CLI's output is its result
      console.log(JSON.stringify(result, null, 2))
    },
    (error: unknown) => {
      // eslint-disable-next-line no-console -- the CLI reports its own failure
      console.error(`judge: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    },
  )
}

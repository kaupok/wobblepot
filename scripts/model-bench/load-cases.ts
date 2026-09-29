import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASE_SCHEMAS, type BenchCase, type Task } from './case-schema'

/** `scripts/model-bench/cases`, resolved from this file so the cwd does not matter. */
export const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'cases')

/**
 * Load and validate every `cases/<task>/*.json` for the given tasks, sorted by
 * file name so a run is reproducible. Throws on the first invalid file, naming
 * it — a bad case is a broken benchmark, not a skipped one.
 */
export function loadCases(tasks: readonly Task[], casesDir: string = CASES_DIR): BenchCase[] {
  const cases: BenchCase[] = []

  for (const task of tasks) {
    const dir = join(casesDir, task)
    if (!existsSync(dir)) {
      throw new Error(`No case directory for task "${task}": ${dir}`)
    }

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()

    for (const file of files) {
      const path = join(dir, file)
      const label = relative(casesDir, path)

      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(path, 'utf8'))
      } catch (err) {
        throw new Error(`Invalid case ${label}: not valid JSON (${(err as Error).message})`)
      }

      const parsed = CASE_SCHEMAS[task].safeParse(raw)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')
        throw new Error(`Invalid case ${label}: ${issues}`)
      }

      cases.push({
        task,
        id: `${task}/${basename(file, '.json')}`,
        input: parsed.data,
      } as BenchCase)
    }
  }

  return cases
}

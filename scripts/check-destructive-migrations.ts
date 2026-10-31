/**
 * Flag migration SQL that drops, deletes or rewrites data (HON-1512).
 *
 * A code rollback cannot undo such a statement; recovery is Neon PITR, and
 * only within its window. So a migration that carries one gets a human look:
 *
 *   - PR time (`ci.yml` → `destructive-migrations`): the migrations the PR
 *     adds. A match writes the job summary and the workflow labels the PR
 *     `destructive-migration`. It never fails the PR.
 *   - Deploy time (`deploy-production.yml` → `destructive-check`, `--deploy`):
 *     the migrations between the live production commit and the target. A
 *     match fails the run before `migrate`, unless the dispatch set
 *     `confirm_destructive`.
 *
 * Matching is per statement, case-insensitive, with SQL comments removed and
 * the contents of string literals and quoted identifiers blanked, so a
 * keyword in a comment or a column name does not count. Dollar-quoted bodies
 * (`DO $$ … $$`) are code and are matched. Flagged: DROP TABLE, DROP COLUMN,
 * DROP TYPE, TRUNCATE, DELETE FROM, UPDATE … SET, ALTER COLUMN … TYPE (and
 * SET DATA TYPE), RENAME. Not flagged: DROP INDEX, CREATE, ADD COLUMN.
 *
 * Usage:
 *   node scripts/check-destructive-migrations.ts <migration dir>...
 *   node scripts/check-destructive-migrations.ts --deploy
 *     TARGET_SHA          the commit `pick` chose
 *     INPUT_SHA           the dispatch's `sha` input; required with CONFIRM_DESTRUCTIVE
 *     CONFIRM_DESTRUCTIVE `true` lets a match through
 *     GITHUB_REPOSITORY   owner/name
 *     GH_TOKEN            read by `gh`
 * Both write `found=true|false` to GITHUB_OUTPUT and the list to
 * GITHUB_STEP_SUMMARY when there is a match.
 */

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Runs `gh` or `git` with these arguments and returns stdout; throws on a non-zero exit. */
export type Run = (args: string[]) => string

export interface Statement {
  /** The statement with comments removed and whitespace collapsed, for the report. */
  text: string
  /** `text` with string and quoted-identifier contents blanked, for matching. */
  code: string
}

export interface Finding {
  migration: string
  statement: string
  patterns: string[]
}

export const LABEL = 'destructive-migration'

export const PATTERNS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['DROP TABLE', /\bDROP\s+TABLE\b/i],
  ['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
  ['DROP TYPE', /\bDROP\s+TYPE\b/i],
  ['TRUNCATE', /\bTRUNCATE\b/i],
  ['DELETE FROM', /\bDELETE\s+FROM\b/i],
  // Not `ON UPDATE`: every Prisma foreign key ends in `ON UPDATE CASCADE`.
  ['UPDATE … SET', /(?<!\bON\s+)\bUPDATE\b[\s\S]*?\bSET\b/i],
  ['ALTER COLUMN … TYPE', /\bALTER\s+COLUMN\s+(?:""|\w+)\s+(?:SET\s+DATA\s+)?TYPE\b/i],
  ['RENAME', /\bRENAME\b/i],
]

const MIGRATION_SQL = /^prisma\/migrations\/[^/]+\/migration\.sql$/

const MAX_STATEMENT_LENGTH = 160

const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/** The end of the quoted run that opens at `start`; a doubled quote is an escaped one. */
function closingQuote(sql: string, start: number): number {
  const quote = sql[start]
  let i = start + 1
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] !== quote) return i
      i += 2
    } else i++
  }
  return sql.length - 1
}

/** The index after the block comment that opens at `start`. Postgres nests them. */
function blockCommentEnd(sql: string, start: number): number {
  let depth = 1
  let i = start + 2
  while (i < sql.length && depth > 0) {
    if (sql.startsWith('/*', i)) {
      depth++
      i += 2
    } else if (sql.startsWith('*/', i)) {
      depth--
      i += 2
    } else i++
  }
  return i
}

/** Splits SQL on `;` outside quotes and dollar-quoted bodies, dropping comments. */
export function splitStatements(sql: string): Statement[] {
  const statements: Statement[] = []
  let text = ''
  let code = ''
  let dollarTag: string | null = null
  const push = () => {
    const statement = { text: collapse(text), code: collapse(code) }
    if (statement.text !== '') statements.push(statement)
    text = ''
    code = ''
  }

  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      text += ' '
      code += ' '
    } else if (sql.startsWith('/*', i)) {
      i = blockCommentEnd(sql, i)
      text += ' '
      code += ' '
    } else if (ch === "'" || ch === '"') {
      const end = closingQuote(sql, i)
      text += sql.slice(i, end + 1)
      code += ch + ch
      i = end + 1
    } else if (ch === '$' && /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(i))) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))![0]
      if (dollarTag === null) dollarTag = tag
      else if (dollarTag === tag) dollarTag = null
      text += tag
      code += tag
      i += tag.length
    } else if (ch === ';' && dollarTag === null) {
      push()
      i++
    } else {
      text += ch
      code += ch
      i++
    }
  }
  push()
  return statements
}

/** The names of the patterns this statement's code matches, in `PATTERNS` order. */
export function destructivePatterns(code: string): string[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(code)).map(([name]) => name)
}

/** One finding per statement in this migration's SQL that matches a pattern. */
export function checkSql(migration: string, sql: string): Finding[] {
  return splitStatements(sql).flatMap(({ text, code }) => {
    const patterns = destructivePatterns(code)
    if (patterns.length === 0) return []
    const statement =
      text.length > MAX_STATEMENT_LENGTH ? `${text.slice(0, MAX_STATEMENT_LENGTH - 1)}…` : text
    return [{ migration, statement, patterns }]
  })
}

/** Checks `<dir>/migration.sql` for each migration directory. */
export function checkMigrationDirs(
  dirs: string[],
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): Finding[] {
  return dirs.flatMap((dir) => checkSql(path.basename(dir), read(path.join(dir, 'migration.sql'))))
}

/** The markdown list for the job summary. */
export function summaryMarkdown(findings: Finding[], intro: string): string {
  const lines = findings.map(
    ({ migration, statement, patterns }) =>
      `- \`${migration}\`: ${patterns.join(', ')} — \`${statement.replaceAll('`', "'")}\``,
  )
  return ['### Destructive migration statements', '', intro, '', ...lines, ''].join('\n')
}

/** The commit of the ACTIVE Production deployment record, or null when there is none. */
export function liveProductionSha(gh: Run, repo: string): string | null {
  const [owner, name] = repo.split('/')
  const body = JSON.parse(
    gh([
      'api',
      'graphql',
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-f',
      `query=query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          deployments(environments: ["Production"], orderBy: { field: CREATED_AT, direction: DESC }, first: 100) {
            nodes { state commit { oid } }
          }
        }
      }`,
    ]),
  ) as {
    data?: {
      repository?: {
        deployments?: { nodes?: { state: string; commit: { oid: string } | null }[] }
      }
    }
  }
  const nodes = body.data?.repository?.deployments?.nodes ?? []
  return nodes.find((node) => node.state === 'ACTIVE' && node.commit !== null)?.commit?.oid ?? null
}

function isCommit(git: Run, sha: string): boolean {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

/**
 * The `migration.sql` paths the target adds over the baseline. With no
 * baseline, or one this clone does not have, every migration at the target:
 * an unknown starting point must not skip the check.
 */
export function pendingMigrations(git: Run, baseline: string | null, target: string): string[] {
  const listing =
    baseline !== null && isCommit(git, baseline)
      ? git(['diff', '--diff-filter=A', '--name-only', baseline, target, '--', 'prisma/migrations'])
      : git(['ls-tree', '-r', '--name-only', target, '--', 'prisma/migrations'])
  return listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => MIGRATION_SQL.test(line))
    .sort()
}

export interface Gate {
  baseline: string | null
  pending: string[]
  findings: Finding[]
  /** True when the run must stop before `migrate`. */
  held: boolean
}

/**
 * The deploy-time check: hold the run when a pending migration matches and
 * nobody confirmed. A confirmation needs the dispatch's `sha` input: an empty
 * one picks the newest green commit, which can be newer than the held one and
 * carry statements nobody read.
 */
export function deployGate(options: {
  repo: string
  target: string
  confirmed: boolean
  /** The dispatch's `sha` input, empty when the pick chose the commit. */
  inputSha: string
  gh: Run
  git: Run
}): Gate {
  const { repo, target, confirmed, inputSha, gh, git } = options
  if (confirmed && inputSha === '') {
    throw new Error(
      'confirm_destructive needs the sha of the held run (-f sha=<sha>), so it covers only the list you read',
    )
  }
  const baseline = liveProductionSha(gh, repo)
  const pending = pendingMigrations(git, baseline, target)
  const findings = pending.flatMap((file) =>
    checkSql(path.basename(path.dirname(file)), git(['show', `${target}:${file}`])),
  )
  return { baseline, pending, findings, held: findings.length > 0 && !confirmed }
}

const run =
  (command: string): Run =>
  (args) =>
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function report(findings: Finding[], intro: string): void {
  for (const { migration, statement, patterns } of findings) {
    console.log(`${migration}: ${patterns.join(', ')}: ${statement}`)
  }
  const output = process.env.GITHUB_OUTPUT
  if (output) appendFileSync(output, `found=${findings.length > 0}\n`)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary && findings.length > 0) appendFileSync(summary, summaryMarkdown(findings, intro))
}

function prMain(dirs: string[]): void {
  console.log(`Checking ${dirs.length} added migration(s).`)
  const findings = checkMigrationDirs(dirs)
  report(
    findings,
    `This PR adds statements that drop, delete or rewrite data. A code rollback cannot undo them. The production deploy holds them until it is dispatched with \`confirm_destructive\`.`,
  )
  if (findings.length === 0) console.log('No destructive statements.')
}

function deployMain(): void {
  const repo = process.env.GITHUB_REPOSITORY
  const target = process.env.TARGET_SHA
  if (!repo || !target) throw new Error('GITHUB_REPOSITORY and TARGET_SHA are required')
  const confirmed = process.env.CONFIRM_DESTRUCTIVE === 'true'
  const gate = deployGate({
    repo,
    target,
    confirmed,
    inputSha: process.env.INPUT_SHA ?? '',
    gh: run('gh'),
    git: run('git'),
  })

  console.log(
    gate.baseline === null
      ? 'No live Production deployment record: checking every migration at the target.'
      : `Live production commit: ${gate.baseline}`,
  )
  console.log(`Pending migrations (${gate.pending.length}):`)
  for (const file of gate.pending) console.log(`  ${file}`)
  report(
    gate.findings,
    `The pending migrations drop, delete or rewrite data. A code rollback cannot undo them.${
      confirmed ? ' The run was dispatched with `confirm_destructive`, so it continues.' : ''
    }`,
  )

  if (gate.held) {
    console.log(
      `::error::Pending migrations contain destructive statements (listed above). Check them, then dispatch again with -f sha=${target} -f confirm_destructive=true.`,
    )
    process.exit(1)
  }
  if (gate.findings.length > 0) {
    console.log('::warning::Destructive statements confirmed with confirm_destructive.')
  } else console.log('No destructive statements.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    if (args[0] === '--deploy') deployMain()
    else prMain(args)
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

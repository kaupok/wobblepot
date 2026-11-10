import fs from 'node:fs'

import type { ListedIssue } from './verdict'

/**
 * Read-only access to the Linear GraphQL API for `pnpm judge list`, `issue` and
 * `cite` (HON-1635). The judge's two writes (one comment, one label) stay in the
 * skill through the Linear MCP, so this file sends queries only.
 */

const ENDPOINT = 'https://api.linear.app/graphql'
const KEY_HELP =
  'Set LINEAR_API_KEY in the environment or in .env at the repository root (docs/ENVIRONMENT_SETUP.md).'

// Linear has no `Duplicate` issue in the live data to read a type from, so drop by name.
const CLOSED_NAMES = new Set(['Done', 'Canceled', 'Duplicate'])

export interface LinearDeps {
  fetch: typeof fetch
  env: Record<string, string | undefined>
  /** `.env` at the repository root, read when the environment has no key. */
  envFile: string
}

export function readApiKey({ env, envFile }: Pick<LinearDeps, 'env' | 'envFile'>): string {
  const fromEnv = env.LINEAR_API_KEY?.trim()
  if (fromEnv) return fromEnv
  if (fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('LINEAR_API_KEY='))
    const value = line
      ?.slice('LINEAR_API_KEY='.length)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2')
    if (value) return value
  }
  throw new Error(`LINEAR_API_KEY is not set. ${KEY_HELP}`)
}

/** An ID Linear does not know; `cite` skips it, so `finalize` drops the citation. */
export class NotFoundError extends Error {}

type Query = (query: string, variables?: Record<string, unknown>) => Promise<unknown>

export function linearClient(deps: LinearDeps): Query {
  const key = readApiKey(deps)
  return async (query, variables = {}) => {
    if (/mutation/i.test(query)) throw new Error('the judge sends queries only, never a mutation')
    const response = await deps.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = (await response.json().catch(() => null)) as {
      data?: unknown
      errors?: { message?: string }[]
    } | null
    const error = body?.errors?.[0]?.message ?? (response.ok ? null : `HTTP ${response.status}`)
    if (error?.startsWith('Entity not found')) throw new NotFoundError(error)
    if (error !== null || !body?.data) {
      throw new Error(`Linear API error: ${error ?? 'no data'}. Check LINEAR_API_KEY. ${KEY_HELP}`)
    }
    return body.data
  }
}

interface Page<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

/** Follows `pageInfo.endCursor` until `hasNextPage` is false. */
async function allPages<T>(fetchPage: (after: string | null) => Promise<Page<T>>): Promise<T[]> {
  const nodes: T[] = []
  let after: string | null = null
  for (;;) {
    const page = await fetchPage(after)
    nodes.push(...page.nodes)
    if (!page.pageInfo.hasNextPage) return nodes
    after = page.pageInfo.endCursor
  }
}

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }'

export const AUTO_DRAFTS_QUERY = `query AutoDrafts($after: String) {
  issues(first: 100, after: $after, filter: { team: { key: { eq: "HON" } }, title: { startsWith: "[AUTO DRAFT]" } }) {
    nodes { identifier title state { name } labels { nodes { name } } }
    ${PAGE_INFO}
  }
}`

export const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) { identifier title description createdAt state { name } labels { nodes { name } } }
}`

export const COMMENTS_QUERY = `query Comments($id: String!, $after: String) {
  issue(id: $id) { comments(first: 100, after: $after) { nodes { createdAt body } ${PAGE_INFO} } }
}`

export const HISTORY_QUERY = `query History($id: String!, $after: String) {
  issue(id: $id) { history(first: 100, after: $after) { nodes { createdAt fromState { name } toState { name } } ${PAGE_INFO} } }
}`

interface IssueNode {
  identifier: string
  title: string
  description?: string | null
  createdAt?: string
  state: { name: string }
  labels: { nodes: { name: string }[] }
}

/** Every open `[AUTO DRAFT]` issue of team HON, in the shape `pnpm judge select` reads. */
export async function listAutoDrafts(query: Query): Promise<ListedIssue[]> {
  const nodes = await allPages(async (after) => {
    const data = (await query(AUTO_DRAFTS_QUERY, { after })) as { issues: Page<IssueNode> }
    return data.issues
  })
  return nodes
    .filter((n) => !CLOSED_NAMES.has(n.state.name))
    .map((n) => ({ id: n.identifier, title: n.title, labels: n.labels.nodes.map((l) => l.name) }))
}

/** One issue in the `select` shape, for `/judge HON-XX`, whatever its status. */
export async function listOne(query: Query, id: string): Promise<ListedIssue[]> {
  const issue = await getIssue(query, id)
  return [
    { id: issue.identifier, title: issue.title, labels: issue.labels.nodes.map((l) => l.name) },
  ]
}

async function getIssue(query: Query, id: string): Promise<IssueNode> {
  const notFound = new NotFoundError(`${id} not found in Linear`)
  const data = (await query(ISSUE_QUERY, { id }).catch((error: unknown) => {
    throw error instanceof NotFoundError ? notFound : error
  })) as { issue: IssueNode | null }
  if (!data.issue) throw notFound
  return data.issue
}

/** `{ title, description, labels }`, the shape `pnpm judge gate --issue` reads. */
export async function fetchIssue(
  query: Query,
  id: string,
): Promise<{ title: string; description: string; labels: string[] }> {
  const issue = await getIssue(query, id)
  return {
    title: issue.title,
    description: issue.description ?? '',
    labels: issue.labels.nodes.map((l) => l.name),
  }
}

interface StateChange {
  createdAt: string
  fromState: { name: string } | null
  toState: { name: string } | null
}

/** The status at `before`: the last state change before it, else the state the first later change left. */
export function statusAt(changes: StateChange[], before: string, current: string): string {
  const moves = changes
    .filter((c) => c.toState !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const earlier = moves.filter((c) => c.createdAt < before)
  const last = earlier[earlier.length - 1]
  if (last) return last.toState?.name ?? current
  return moves[0]?.fromState?.name ?? current
}

/**
 * The text `pnpm judge finalize` checks a Linear quote against: `Status:` on
 * line 1, the description, then every comment with its date. `## Judge:`
 * comments stay in; `stripJudgeComments` removes them. With `before`, the text
 * is the issue as it stood then, for the backtest, or null when the issue did
 * not exist yet.
 */
export async function fetchCitedText(
  query: Query,
  id: string,
  before?: string,
): Promise<string | null> {
  const issue = await getIssue(query, id)
  if (before && issue.createdAt && issue.createdAt >= before) return null
  const comments = await allPages(async (after) => {
    const data = (await query(COMMENTS_QUERY, { id, after })) as {
      issue: { comments: Page<{ createdAt: string; body: string }> }
    }
    return data.issue.comments
  })
  let status = issue.state.name
  if (before) {
    const history = await allPages(async (after) => {
      const data = (await query(HISTORY_QUERY, { id, after })) as {
        issue: { history: Page<StateChange> }
      }
      return data.issue.history
    })
    status = statusAt(history, before, status)
  }
  const kept = comments
    .filter((c) => !before || c.createdAt < before)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return [
    `Status: ${status}`,
    '',
    issue.description ?? '',
    ...kept.flatMap((c) => ['', `--- Comment ${c.createdAt}`, c.body]),
    '',
  ].join('\n')
}

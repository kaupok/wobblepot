/**
 * The text of a request that reaches the model as instructions, for the
 * dry-run estimate and the golden's hashes (HON-931). Apart from `tasks.ts`
 * so a task spec in its own file (`adjust.ts`) can use it without a cycle.
 */

import { asSchema, type FlexibleSchema } from 'ai'

import type { PreparedCase } from './tasks'

export function textOf(request: {
  system?: string
  prompt?: string
  messages?: unknown[]
}): string {
  const parts: string[] = []
  if (request.system) parts.push(request.system)
  if (request.prompt) parts.push(request.prompt)
  for (const message of request.messages ?? []) {
    const content = (message as { content: unknown }).content
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content)) {
      for (const part of content as { type: string; text?: string }[]) {
        if (part.type === 'text' && part.text) parts.push(part.text)
      }
    }
  }
  return parts.join('\n')
}

/**
 * Not key-sorted: property order is part of what the model receives. Throws
 * rather than hash `{}` if the SDK ever builds the JSON Schema asynchronously.
 */
export function schemaTextOf(schema: FlexibleSchema<unknown>): string {
  const json = asSchema(schema).jsonSchema
  if ('then' in json && typeof json.then === 'function') {
    throw new Error(
      'The AI SDK built this JSON Schema asynchronously; schemaTextOf cannot hash it.',
    )
  }
  return JSON.stringify(json)
}

/** The parts of a request that reach the model as instructions. */
export function requestTexts(
  request: Parameters<typeof textOf>[0] & { schema: FlexibleSchema<unknown> },
): Pick<PreparedCase, 'promptText' | 'schemaText'> {
  return { promptText: textOf(request), schemaText: schemaTextOf(request.schema) }
}

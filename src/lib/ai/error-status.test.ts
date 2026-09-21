import { describe, expect, it } from 'vitest'
import { APICallError, RetryError } from 'ai'
import { aiErrorStatusCode } from './error-status'

const apiError = (statusCode: number) =>
  new APICallError({
    message: 'busy',
    url: 'https://api.openai.com/v1/images/generations',
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode === 429 || statusCode >= 500,
  })

describe('aiErrorStatusCode', () => {
  it('reads the status of a bare provider error', () => {
    expect(aiErrorStatusCode(apiError(429))).toBe(429)
  })

  it('unwraps the RetryError ai@7 throws once retries are exhausted', () => {
    const error = new RetryError({
      message: 'Failed after 2 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError(429), apiError(503)],
    })

    expect(aiErrorStatusCode(error)).toBe(503)
  })

  it('reads a plain `status` field', () => {
    expect(aiErrorStatusCode({ status: 529 })).toBe(529)
  })

  it('returns undefined when there is no status', () => {
    expect(aiErrorStatusCode(new Error('boom'))).toBeUndefined()
    expect(aiErrorStatusCode(null)).toBeUndefined()
  })
})

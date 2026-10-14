import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { apiKey: { update: vi.fn() } } }))

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { API_KEY_PATTERN, apiKeyStart, generateApiKey, hashApiKey, verifyApiKey } from './api-keys'

describe('API key format (HON-1220)', () => {
  it('is wp_ followed by 32 characters from [A-Za-z0-9]', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateApiKey()).toMatch(/^wp_[A-Za-z0-9]{32}$/)
    }
  })

  it('makes a different key every time', () => {
    const keys = new Set(Array.from({ length: 100 }, generateApiKey))
    expect(keys.size).toBe(100)
  })

  it('hashes the whole key with hex SHA-256', () => {
    const key = 'wp_abcdefghijklmnopqrstuvwxyz012345'
    expect(hashApiKey(key)).toBe(createHash('sha256').update(key).digest('hex'))
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('shows wp_ and the first 6 random characters as the start', () => {
    expect(apiKeyStart('wp_abcdefghijklmnopqrstuvwxyz012345')).toBe('wp_abcdef')
  })

  it.each([
    ['empty', ''],
    ['no prefix', 'abcdefghijklmnopqrstuvwxyz012345'],
    ['too short', 'wp_abc'],
    ['too long', 'wp_abcdefghijklmnopqrstuvwxyz0123456'],
    ['a character outside the alphabet', 'wp_abcdefghijklmnopqrstuvwxyz01234-'],
  ])('refuses %s before any lookup', async (_label, key) => {
    expect(API_KEY_PATTERN.test(key)).toBe(false)
    expect(await verifyApiKey(key)).toBeNull()
    expect(prisma.apiKey.update).not.toHaveBeenCalled()
  })
})

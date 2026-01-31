import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

function createMockRequest(url: string = 'http://localhost/api/ingredients') {
  return new NextRequest(url)
}

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mockGetSession = vi.mocked(auth.api.getSession)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)

const mockSession = {
  user: { id: 'user-123', name: 'John', email: 'john@example.com' },
  session: { id: 'session-123' },
}

describe('GET /api/ingredients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns empty array for empty search', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual([])
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('returns empty array for whitespace-only search', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=   '))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toEqual([])
  })

  it('returns matching ingredients for search query', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockQueryRaw.mockResolvedValue([
      {
        id: 'ing-1',
        name: 'Chicken breast',
        category: 'protein',
        defaultUnit: 'g',
        similarity: 0.8,
      },
      {
        id: 'ing-2',
        name: 'Chicken thigh',
        category: 'protein',
        defaultUnit: 'g',
        similarity: 0.6,
      },
    ] as never)

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=chicken'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ingredients).toHaveLength(2)
    expect(data.ingredients[0].name).toBe('Chicken breast')
    expect(data.ingredients[1].name).toBe('Chicken thigh')
  })

  it('returns 500 when query fails', async () => {
    mockGetSession.mockResolvedValue(mockSession as never)
    mockQueryRaw.mockRejectedValue(new Error('DB error'))

    const response = await GET(createMockRequest('http://localhost/api/ingredients?search=test'))
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to search ingredients')
  })
})

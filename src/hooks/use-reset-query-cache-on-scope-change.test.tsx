import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useResetQueryCacheOnScopeChange } from './use-reset-query-cache-on-scope-change'

// The production client's staleTime, so a mount with cached data does not
// refetch on its own and only the reset can replace the old household's data.
function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000, retry: false } },
  })
}

function Scope({
  client,
  scope,
  children,
}: {
  client: QueryClient
  scope: string
  children?: ReactNode
}) {
  useResetQueryCacheOnScopeChange(client, scope)
  return <>{children}</>
}

function Usage({ fetchUsage }: { fetchUsage: () => Promise<string> }) {
  const { data } = useQuery({ queryKey: ['ai-usage'], queryFn: fetchUsage })
  return <p>{data ?? 'loading'}</p>
}

function renderScoped(client: QueryClient, scope: string, children?: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <Scope client={client} scope={scope}>
        {children}
      </Scope>
    </QueryClientProvider>
  )
}

function seedOldHousehold(client: QueryClient) {
  client.setQueryData(['meals'], ['meal-from-h1'])
  client.setQueryData(['ai-usage'], 'usage-h1')
}

describe('useResetQueryCacheOnScopeChange', () => {
  it('keeps the cache on the first render', () => {
    const client = makeClient()
    seedOldHousehold(client)

    render(renderScoped(client, 'u1:h1'))

    expect(client.getQueryData(['meals'])).toEqual(['meal-from-h1'])
    expect(client.getQueryData(['ai-usage'])).toBe('usage-h1')
  })

  it('keeps the cache when the scope does not change', () => {
    const client = makeClient()
    seedOldHousehold(client)

    const { rerender } = render(renderScoped(client, 'u1:h1'))
    rerender(renderScoped(client, 'u1:h1'))

    expect(client.getQueryData(['meals'])).toEqual(['meal-from-h1'])
  })

  it('after a leave or a move, the destination shows the new household and the cache holds nothing from the old one', async () => {
    const client = makeClient()
    seedOldHousehold(client)
    const fetchOld = vi.fn(async () => 'usage-h1')
    const fetchNew = vi.fn(async () => 'usage-h2')

    const { rerender } = render(renderScoped(client, 'u1:h1', <Usage fetchUsage={fetchOld} />))
    expect(screen.getByText('usage-h1')).toBeInTheDocument()

    // The destination mounts in the same commit as the new scope, and reads the
    // old household's fresh cache entry first.
    rerender(renderScoped(client, 'u1:h2', <Usage fetchUsage={fetchNew} />))

    expect(await screen.findByText('usage-h2')).toBeInTheDocument()
    expect(fetchNew).toHaveBeenCalledTimes(1)
    // The page being left never refetched against the household it left.
    expect(fetchOld).not.toHaveBeenCalled()
    expect(client.getQueryData(['meals'])).toBeUndefined()
    const cached = client
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data)
    expect(cached).not.toContain('usage-h1')
    expect(cached).not.toContainEqual(['meal-from-h1'])
  })

  it('after a sign-out, the cache holds no entry at all', async () => {
    const client = makeClient()
    seedOldHousehold(client)
    const fetchUsage = vi.fn(async () => 'usage-h1')

    const { rerender } = render(renderScoped(client, 'u1:h1', <Usage fetchUsage={fetchUsage} />))
    // The signed-out destination has no household queries.
    rerender(renderScoped(client, ':'))

    await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0))
    expect(fetchUsage).not.toHaveBeenCalled()
  })
})

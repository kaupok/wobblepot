'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Body, Heading } from '@/components/ui/typography'

export interface SignupCodeRow {
  id: string
  code: string
  createdAt: string
  usedAt: string | null
  expiresAt: string | null
  note: string | null
  usedByEmail: string | null
}

interface CodesResponse {
  codes: SignupCodeRow[]
}

const QUERY_KEY = ['admin', 'signup-codes'] as const

interface SignupCodesClientProps {
  initialCodes: SignupCodeRow[]
}

export function SignupCodesClient({ initialCodes }: SignupCodesClientProps) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')

  const { data } = useQuery<CodesResponse>({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<CodesResponse>('/api/admin/signup-codes'),
    initialData: { codes: initialCodes },
  })

  const mintMutation = useMutation({
    mutationFn: (input: { note: string }) =>
      apiFetch<{ code: SignupCodeRow }>('/api/admin/signup-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: input.note || undefined }),
      }),
    onSuccess: ({ code }) => {
      setNote('')
      toast.success(`Code ${code.code} created`)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/admin/signup-codes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      toast.success('Code revoked')
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleMintSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mintMutation.mutate({ note: note.trim() })
  }

  const codes = data?.codes ?? []

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <Heading variant="h4">Mint a new code</Heading>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleMintSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Input
                id="note"
                type="text"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. For Anna at family dinner"
                disabled={mintMutation.isPending}
              />
            </div>
            <Button type="submit" disabled={mintMutation.isPending}>
              {mintMutation.isPending ? 'Creating...' : 'Create code'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Heading variant="h4">Existing codes</Heading>
          <Body variant="muted">Most recent 100 codes. Used codes cannot be revoked.</Body>
        </CardHeader>
        <CardContent>
          {codes.length === 0 ? (
            <Body variant="muted">No codes yet. Mint one above to get started.</Body>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="codes-list">
              {codes.map((row) => {
                const used = !!row.usedAt
                return (
                  <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Body className="font-mono">{row.code}</Body>
                      <Body variant="small" className="text-muted-foreground">
                        Created {new Date(row.createdAt).toLocaleString()}
                        {row.note ? ` · ${row.note}` : ''}
                        {used ? ` · Used by ${row.usedByEmail ?? 'unknown'}` : ' · Unused'}
                      </Body>
                    </div>
                    {!used && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => revokeMutation.mutate(row.id)}
                        disabled={revokeMutation.isPending}
                        aria-label={`Revoke code ${row.code}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

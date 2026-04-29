'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

const API_CASES = [
  { key: 'throw', label: 'API plain throw (bullets 1, 9)' },
  { key: 'typed', label: 'API typed AI error (bullet 4)' },
  { key: 'pii', label: 'API PII scrub test (bullet 8)' },
  { key: 'ext-fetch-fail', label: 'External fetch fail (bullet 6)' },
] as const

export function DebugErrorButtons() {
  const [boom, setBoom] = useState(false)
  const [log, setLog] = useState<string[]>([])

  if (boom) {
    // Render-time throw — caught by the nearest error.tsx (HON-526 bullet 2).
    throw new Error('Debug: deliberate client render throw (HON-526 bullet 2)')
  }

  async function call(testCase: string) {
    const res = await fetch(`/api/debug/errors?case=${testCase}`, { method: 'POST' })
    setLog((prev) => [...prev, `${testCase} → HTTP ${res.status}`])
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <Button onClick={() => setBoom(true)} variant="destructive">
        Trigger client throw → error.tsx (bullet 2)
      </Button>
      {API_CASES.map(({ key, label }) => (
        <Button key={key} onClick={() => call(key)}>
          {label}
        </Button>
      ))}
      <Button asChild variant="outline">
        <a href="/debug/errors/rsc-throw">RSC throw → instrumentation.onRequestError (bullet 7)</a>
      </Button>
      {log.length > 0 && (
        <pre className="bg-muted mt-4 rounded p-3 text-xs">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </pre>
      )}
    </div>
  )
}

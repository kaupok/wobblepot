'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Body, Code } from '@/components/ui/typography'
import { track } from '@/lib/analytics'

interface McpServerUrlProps {
  /** `getMcpResource(getServerBaseURL())`: the URL an assistant connects to. */
  url: string
}

const COPIED_RESET_MS = 2000

/**
 * The MCP server URL with a Copy button, on My account → Connections (HON-1153).
 * Copy is the top of the connect funnel, so it captures
 * `mcp:server_url_copied` once per successful copy.
 */
export function McpServerUrl({ url }: McpServerUrlProps) {
  const t = useTranslations('account.assistants')
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(resetTimer.current ?? undefined), [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      toast.error(t('copyFailed'))
      return
    }
    void track('mcp:server_url_copied', { source: 'profile' })
    toast.success(t('copySuccess'))
    setCopied(true)
    clearTimeout(resetTimer.current ?? undefined)
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  return (
    <div className="flex flex-col gap-2">
      <Body variant="small" tone="muted">
        {t('urlLabel')}
      </Body>
      <div className="flex flex-wrap items-center gap-2">
        {/* A long preview host must wrap rather than widen the page. */}
        <div className="min-w-0 break-all">
          <Code>{url}</Code>
        </div>
        <Button type="button" variant="outline" onClick={handleCopy}>
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
    </div>
  )
}

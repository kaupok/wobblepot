/**
 * Shared shell for legal pages (/privacy, /terms — HON-457). The route group
 * keeps URLs clean while inheriting the root chrome (Header + Footer) — the
 * footer carrying the Privacy/Terms links on these pages is itself an
 * acceptance criterion. Prose container mirrors /bot.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-12">{children}</div>
}

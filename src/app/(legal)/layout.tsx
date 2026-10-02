/**
 * Shared shell for legal pages (/privacy, /terms — HON-457). The route group
 * keeps URLs clean while inheriting the root chrome (Header + Footer) — the
 * footer carrying the Privacy/Terms links on these pages is itself an
 * acceptance criterion. Prose container mirrors /bot.
 *
 * The legal pages are English by design (HON-918): legal text is maintained in
 * one language, alongside the DPAs and DPIA in `compliance/`. `lang="en"`
 * makes assistive tech switch pronunciation inside `<html lang>`, which stays
 * the household locale.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="en" className="mx-auto max-w-2xl px-4 py-12">
      {children}
    </div>
  )
}

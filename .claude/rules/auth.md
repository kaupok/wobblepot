---
paths:
  - "src/app/**"
  - "src/components/**/*.tsx"
  - "src/proxy.ts"
  - "src/lib/auth*.ts"
  - "src/lib/session.ts"
---

# Authentication rules

**Protected routes:** check the session with `getSession()` from `@/lib/session` and redirect if null (`requireAccountMember` in `src/app/account/account-member.ts`). `src/proxy.ts` also redirects anonymous requests for `PROTECTED_PREFIXES` to `/sign-in?returnUrl=…`, so they never stream a 200 + skeleton first. It checks the cookie only, so the page owns the real check. `src/proxy.test.ts` fails on a top-level route in neither `PROTECTED_PREFIXES` nor `PUBLIC_ROUTES`.

**Client:** `authClient.signIn.email()` with callbacks (`src/app/sign-in/SignInForm.tsx`). Sign out: `authClient.signOut()` + `router.push()` + `router.refresh()`. Templates are in `.claude/templates/`.

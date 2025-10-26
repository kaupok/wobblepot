# Run Authentication Tests

Run all authentication-related tests to verify auth functionality.

## Commands to run

```bash
# Run all tests matching "auth" or "sign-in" or "sign-up"
pnpm test auth sign-in sign-up

# Run auth page tests specifically
pnpm test src/app/sign-in
pnpm test src/app/sign-up
pnpm test src/app/profile

# Run with coverage
pnpm test:coverage -- auth sign-in sign-up

# Run E2E tests (if auth E2E tests exist)
pnpm test:e2e --grep "auth|sign-in|sign-up"
```

## Manual Testing Checklist

If automated tests pass, consider manual testing:

1. **Sign Up Flow**
   - Create new account
   - Verify email validation
   - Check password requirements (min 8 chars)

2. **Sign In Flow**
   - Sign in with valid credentials
   - Test invalid credentials error handling
   - Verify redirect to profile after sign in

3. **Protected Routes**
   - Access /profile without authentication (should redirect to /sign-in)
   - Access /profile with authentication (should show profile)

4. **Sign Out Flow**
   - Sign out from profile page
   - Verify redirect to home page
   - Confirm session is cleared (try accessing /profile again)

5. **Error Handling**
   - Test with offline mode (network errors)
   - Test with rate limiting (too many attempts)
   - Verify user-friendly error messages

## Better Auth Documentation

If you need to reference Better Auth APIs, use the better-auth MCP server:

```
Ask: "How do I implement password reset in Better Auth?"
```

The better-auth MCP server has access to comprehensive Better Auth documentation.

---
paths:
  - "src/app/**/*.tsx"
  - "src/components/**/*.{ts,tsx}"
  - "src/hooks/**"
---

# Data fetching and forms

## Data Fetching Patterns

**Client Components:** TanStack Query for all client-side data: `useQuery`, not `useEffect` + `fetch` + `useState`; `useMutation`, not manual `try/catch/finally`; loading and error state from the result. Invalidate with `invalidateQueries`, not `router.refresh()`. Optimistic updates use `onMutate`/`onError`/`onSettled`. Fetch with `apiFetch` (`src/lib/api.ts`).

**Query keys:** `['meals']`, `['shopping-list', planId]`, `['meal', mealId]`, `['meal-plan', planId, 'entries']`, `['meals', { search: query }]`.

## Form Handling Patterns

Native HTML forms with controlled inputs and `useState`, no form library. `onSubmit` with `e.preventDefault()`, inputs disabled during submission (`SignInForm`). Validation: HTML5 attributes, the submit handler, then the server.

**Focus that falls to `<body>` sends the user to the top of the page**, and axe cannot see it. Two causes recur: a control `disabled` during a request loses focus, and a Radix `Dialog` opened from controlled state has no trigger to return focus to. The fixes and the test helper are in docs/DESIGN.md → Focus management.

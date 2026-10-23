---
paths:
  - "src/**"
---

# Code rules

- Validate input once, at the boundary that owns it: Zod in `env.ts`, the body check in a route, the parser on AI output. Inside, pass the typed value and do not check it again. A second check hides which layer owns the contract.
- Inline logic that runs in one place. Extract a helper when a second caller needs it or it names a real concept, not to make a function shorter. A split for the file-size cap is by responsibility, which is different.

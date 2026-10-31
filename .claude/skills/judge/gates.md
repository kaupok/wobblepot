# Judge — hard gates

Read from `SKILL.md` → step 2. A hard gate is an area where a wrong verdict is costly, so the judge always holds, even when a recorded decision covers the issue. A human decides these.

`pnpm judge gate` reads the `json` block below. The prose is for the reader; the block is the matcher. Change both together.

| Gate | Labels | Paths | Keywords |
| --- | --- | --- | --- |
| `gtm` | `GTM` | | price, pricing, market, cohort, channel, waitlist |
| `legal` | | `compliance/**`, `src/app/(legal)/**`, `src/app/consent/**` | consent text, policy text, privacy policy, terms of service, DPA, subprocessor |
| `money` | | | paid vendor, paid plan, subscription, invoice, billing |
| `ai-spend` | | `src/lib/ai/budgets.ts`, `src/lib/ai/models.ts` | AI budget, AI cap, AI limit, token budget, spend cap |
| `irreversible` | | `prisma/migrations/**`, `prisma/schema.prisma` | migration, backfill, production deploy, delete household, household data loss |
| `auth` | | `src/lib/auth*`, `src/lib/auth/**`, `src/app/api/auth/**`, `src/proxy.ts`, `src/app/.well-known/**` | OAuth, MCP scope, .well-known, CSP, session token |
| `allergens` | | `src/lib/ai/forbidden-foods.ts` | allergen, allergy, diet filter, dietary restriction, excluded ingredient, food safety |

## How a match works

- **Paths:** the script takes every path-like token from the title and description (`src/lib/x.ts:42` counts as `src/lib/x.ts`) and tests it against each glob. `*` matches inside one path segment, `**` matches across segments.
- **Labels:** exact label name, case-insensitive.
- **Keywords:** case-insensitive, whole words, with an optional plural `s` or `es`, so `allergen` matches `allergens` and `market` does not match `supermarket`. Path-like tokens are removed from the text first, so `channel` does not match `src/lib/channels.ts`. Any other form (`allergy` and `allergies`) needs its own entry.
- The first gate in list order that matches wins. The reason is `hard gate: <name>`.

A false positive costs one Hold, which a human reads anyway. A false negative lets the judge decide in an area the user keeps for themselves. So when unsure, add the keyword.

```json
[
  {
    "name": "gtm",
    "labels": ["GTM"],
    "paths": [],
    "keywords": ["price", "pricing", "market", "cohort", "channel", "waitlist"]
  },
  {
    "name": "legal",
    "labels": [],
    "paths": ["compliance/**", "src/app/(legal)/**", "src/app/consent/**"],
    "keywords": [
      "consent text",
      "policy text",
      "privacy policy",
      "terms of service",
      "DPA",
      "subprocessor"
    ]
  },
  {
    "name": "money",
    "labels": [],
    "paths": [],
    "keywords": ["paid vendor", "paid plan", "subscription", "invoice", "billing"]
  },
  {
    "name": "ai-spend",
    "labels": [],
    "paths": ["src/lib/ai/budgets.ts", "src/lib/ai/models.ts"],
    "keywords": ["AI budget", "AI cap", "AI limit", "token budget", "spend cap"]
  },
  {
    "name": "irreversible",
    "labels": [],
    "paths": ["prisma/migrations/**", "prisma/schema.prisma"],
    "keywords": [
      "migration",
      "backfill",
      "production deploy",
      "delete household",
      "household data loss"
    ]
  },
  {
    "name": "auth",
    "labels": [],
    "paths": [
      "src/lib/auth*",
      "src/lib/auth/**",
      "src/app/api/auth/**",
      "src/proxy.ts",
      "src/app/.well-known/**"
    ],
    "keywords": ["OAuth", "MCP scope", ".well-known", "CSP", "session token"]
  },
  {
    "name": "allergens",
    "labels": [],
    "paths": ["src/lib/ai/forbidden-foods.ts"],
    "keywords": [
      "allergen",
      "allergy",
      "allergies",
      "diet filter",
      "dietary restriction",
      "excluded ingredient",
      "food safety"
    ]
  }
]
```

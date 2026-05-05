# Compliance

Honkadori OÜ compliance artifacts. Wobblepot is the trade name; all DPAs and vendor agreements are between **Honkadori OÜ** (legal entity) and the vendor.

This folder lives in a private GitHub repo. DPAs do not need to be public — GDPR Art. 28 requires the contracts exist, not that they're published. Public transparency is satisfied by the Processors section in the privacy policy (Art. 13/14).

## Pre-launch state (as of 2026-05-05)

- No production user data has been processed through any vendor.
- Account migrations from personal → Honkadori OÜ are therefore clean — no controller-to-controller paperwork required.
- Honkadori OÜ is not KMKR-registered. Vendors will charge their local VAT instead of zero-rating via reverse-charge. Add VAT IDs to billing settings later if/when registered.

## Subprocessors

| #   | Vendor                      | Counterparty entity                      | Role                                 | Processing region  |
| --- | --------------------------- | ---------------------------------------- | ------------------------------------ | ------------------ |
| 1   | Anthropic                   | Anthropic, PBC (verify on first invoice) | LLM — prompts + AI-generated content | US                 |
| 2   | Resend                      | Plus Five, Inc.                          | Transactional email                  | US                 |
| 3   | Vercel                      | Vercel Inc. (verify on first invoice)    | Hosting, request metadata, logs      | US/EU              |
| 4   | Neon (a Databricks company) | Neon Inc.                                | Database — all user records          | **EU (Frankfurt)** |

## DPA status

| #   | Vendor    | SCCs / transfer mechanism             | DPA acceptance                                                                | Filed                        | Account on Honkadori OÜ  |
| --- | --------- | ------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------- | ------------------------ |
| 1   | Anthropic | EU SCCs M2 + UK Addendum + DPF        | auto via [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | pending snapshot             | ☐                        |
| 2   | Resend    | EU SCCs M2 + UK SCCs + DPF            | signed 2026-01-14 (DocuSign envelope `CC958417-9D1F-42CD-8B94-53B5F496F14E`)  | `dpas/resend-2026-01-14.pdf` | ☑ 2026-05-05 (free plan) |
| 3   | Vercel    | EU SCCs M2 + UK Addendum              | auto via Agreement (Pro tier)                                                 | pending snapshot             | ☐                        |
| 4   | Neon      | n/a — EU-EU transfer (no SCCs needed) | pending — requires execution as Honkadori OÜ                                  | pending                      | ☐                        |

## How to add a new processor

When adding any new vendor that processes user data:

1. Sign up using a Honkadori OÜ-controlled account (entity card, not personal)
2. Sign or accept the DPA — auto-via-terms or counter-sign per vendor
3. File the PDF as `compliance/dpas/<vendor>-<YYYY-MM-DD>.pdf`
4. Update the tables above
5. Update the Processors section in `src/app/(legal)/privacy/page.tsx` in the same PR

## See also

- Linear HON-459 — account migration + DPA work (in progress)
- Linear HON-543 — post-beta polish (dedicated subprocessor page, formal DPIA)
- Linear HON-457 — privacy policy

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
| 3   | Vercel                      | Vercel Inc.                              | Hosting, request metadata, logs      | US/EU              |
| 4   | Neon (a Databricks company) | Neon Inc.                                | Database — all user records          | **EU (Frankfurt)** |
| 5   | PostHog                     | PostHog, Inc.                            | Product analytics + error tracking   | EU (Frankfurt)     |

## DPA status

| #   | Vendor    | SCCs / transfer mechanism                                | DPA acceptance                                                                | Filed                                                                       | Account on Honkadori OÜ  |
| --- | --------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------ |
| 1   | Anthropic | EU SCCs M2 + UK Addendum + DPF                           | auto via [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) | `dpas/anthropic-dpa-2026-06-02.pdf` + `dpas/anthropic-terms-2026-06-02.pdf` | ☑ 2026-06-02             |
| 2   | Resend    | EU SCCs M2 + UK SCCs + DPF                               | signed 2026-01-14 (DocuSign envelope `CC958417-9D1F-42CD-8B94-53B5F496F14E`)  | `dpas/resend-2026-01-14.pdf`                                                | ☑ 2026-05-05 (free plan) |
| 3   | Vercel    | EU SCCs 2021 M2 + UK IDTA                                | auto via Agreement (Pro tier, incorporated into ToS)                          | `dpas/vercel-2026-06-02.pdf`                                                | ☑ 2026-06-02             |
| 4   | Neon      | n/a — EU-EU transfer (no SCCs needed)                    | pending — requires execution as Honkadori OÜ                                  | pending                                                                     | ☐                        |
| 5   | PostHog   | verify — EU cloud (Frankfurt); PostHog Inc. is US parent | pending — verify DPA + migrate billing entity                                 | pending                                                                     | ☐                        |

## Migration notes

- **Anthropic** (2026-06-02): the founder's personal "individual" org (ID `eb00b3ae-f58c-436e-8448-e634d3ac5dcc`) was converted **in place** to a business organization named Honkadori OÜ — existing API keys retained, **no key rotation**. Registered business address + company card set; Business tax ID left blank (Honkadori OÜ is not KMKR-registered). The DPA auto-applies via the Commercial Terms to the entity-of-record. Residual personal prepaid credit (~$19.76) remained on the converted org — future personal API use should move to a separate account to keep company/personal spend clean.
- **Vercel** (2026-06-02): billing entity on the `honkadori` Vercel **Team** (id `team_8RqxMojB9r4a20a5GJyH5Ha9`) switched to Honkadori OÜ invoice details + business card; plan confirmed **Pro** (commercial tier). Vercel's DPA (Last Updated 2026-03-17) is auto-incorporated via the Customer Agreement — **no signature**; it binds to the entity-of-record. Transfer mechanism is the 2021 EU SCCs Module Two + UK IDTA (no DPF). A snapshot of the live DPA is filed; processor entity confirmed as **Vercel Inc.** (Delaware).
- **PostHog** added as subprocessor #5 (2026-06-02): live since HON-474 (PostHog Cloud EU, Frankfurt) but missing from the initial scaffold. Billing-entity migration to Honkadori OÜ and DPA filing are still **pending** (tracked under HON-459). Confirm whether PostHog's DPA relies on SCCs/DPF (PostHog Inc. is US-incorporated) or is treated as an EU-EU transfer.

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

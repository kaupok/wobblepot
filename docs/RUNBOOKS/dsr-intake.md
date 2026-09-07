# Support inbox and GDPR DSR intake

Operator runbook for the public support address introduced in HON-487.

## What this covers

- Where `support@wobblepot.com` mail lands and who reads it.
- How to triage a GDPR data-subject request (DSR): export, deletion, rectification, complaint.
- The SLAs we have committed to in the privacy policy and the auto-reply.

This is not a customer-service playbook for general feature questions; it is the operational baseline for legal-grade requests and outage reports. General product questions follow the same SLA but do not require the identity-verification or classification steps below.

## Inbox

- **Address:** `support@wobblepot.com`
- **Routing:** mail is delivered to the data-controller's monitored mailbox. Configuration lives outside the repository (DNS / mail provider). See "Re-creating the auto-reply" below if the provider is changed.
- **Surfaces that publish this address:**
  - `src/components/footer.tsx` — every page (authed + public)
  - `src/app/error.tsx` — route-level error boundary (i18n)
  - `src/app/global-error.tsx` — root error boundary (hardcoded English; renders outside the i18n provider)
  - `src/app/status/page.tsx` — public `/status`
  - `src/app/(legal)/terms/page.tsx` — the Terms contact
  - `LICENSE` (HON-604) — the licensing-questions line in the root notice
  - `README.md` — the Security section, for vulnerability reports
  - `docs/RUNBOOKS/status-page.md` — canonical incident-banner copy, pasted verbatim into a user-facing banner
  - `docs/RUNBOOKS/breach-notification.md` — the `supportUrl` value for the Art. 34 affected-user email
  - `docs/EMAIL_SETUP.md` — outbound-sender notes
  - This runbook — the **Address** line above
  - _Not_ the privacy policy: `src/app/(legal)/privacy/page.tsx` imports `PRIVACY_EMAIL` and publishes `privacy@wobblepot.com` in all four of its contact spots. It rotates with that constant, not this one.
- **Regenerate this list; do not trust it.** It has been wrong twice. The authoritative pair is `git grep -n 'support@wobblepot.com' -- ':!pnpm-lock.yaml'` and `git grep -ln SUPPORT_EMAIL -- 'src/**'`; run both before a rotation and reconcile against the entries above.
- **One source of truth:** `src/lib/support.ts` exports `SUPPORT_EMAIL` and `SUPPORT_EMAIL_HREF`. Every `.tsx` entry above imports them, so app code is one edit. The `LICENSE`, `README.md`, and `docs/**` entries hardcode the literal and need hand edits — static files and runbook copy have no import mechanism. `src/lib/resend.ts` names the constant in a comment only. Five tests and stories assert the literal (`src/app/error.test.tsx`, `src/app/global-error.test.tsx`, `src/app/status/page.test.tsx`, `src/components/footer.test.tsx`, `src/components/footer.stories.tsx`) — they fail loudly on a rotation, which is the backstop for anything this list still misses.

## SLAs

| Commitment                                        | Target                                                                                        | Source                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Incoming messages reach a human                   | within 24 hours during working days                                                           | HON-487 acceptance criteria                                                    |
| First substantive response                        | 3 working days                                                                                | auto-reply to incoming mail                                                    |
| GDPR DSR acknowledgement                          | 72 hours from receipt                                                                         | GDPR Art. 12(3) — internal commitment, stricter than the statute               |
| GDPR DSR fulfilment                               | 30 days from receipt; extendable to 90 days for complex requests with notice to the requester | GDPR Art. 12(3)                                                                |
| Breach-related mail (subprocessor or user report) | escalate immediately to the breach runbook                                                    | see [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) (HON-482) |

The 24-hour and 3-working-day commitments are softer than the GDPR clock and apply to all mail, not just DSRs. The 72-hour and 30-day commitments only apply to GDPR DSRs and are statutory — do not silently miss them.

## DSR types

A DSR is any user-initiated request to exercise rights under GDPR. The inbox accepts all four; the user does not need to know which type to file under.

| Type                  | Right (GDPR Art.)                       | What we do                                                                                                                                                   |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Export / portability  | Art. 15 (access), Art. 20 (portability) | Direct user to `/api/auth/user/export` once HON-458 ships. Until then, fulfil manually from the database                                                     |
| Deletion / erasure    | Art. 17                                 | Initiate the 30-day grace-window deletion (HON-481, when it lands). Until then, hard-delete via Prisma Studio with confirmation                              |
| Rectification         | Art. 16                                 | Edit in-app where possible; manual update otherwise. Document in the audit trail                                                                             |
| Complaint / objection | Art. 21, recital 141                    | Acknowledge; remind the user they may complain to their local supervisory authority (AKI for Estonia). Do not treat as adversarial — investigate and respond |

If a request is ambiguous ("delete my data"), default to the strictest interpretation (full erasure) and confirm with the user before acting irreversibly.

## Identity verification

**Default:** if the request comes from the email address registered to the account, that is sufficient verification. Do not over-collect — Art. 12(6) only allows asking for additional ID when there is "reasonable doubt" about the identity of the requester.

**Escalate** when:

- The "from" address does not match any account
- The request is for a third party (e.g., "delete my husband's account")
- The request asks us to send the export to a different email
- The request is plausibly being made by a compromised account (sudden deletion request right after suspicious sign-in activity)

In escalation cases ask for one additional signal — the most recent invoice email, the date of last sign-in, or a reply confirmation sent to the registered address. **Never** ask for a passport scan, ID document, or government-issued credential.

## Triage checklist

For each incoming DSR:

1. [ ] Acknowledge within 72 hours. Use a short reply: "We received your request and will respond within 30 days per GDPR Art. 12(3)." Note the receipt date in the reply.
2. [ ] Classify the request type (export / deletion / rectification / complaint). If ambiguous, ask one clarifying question; do not guess.
3. [ ] Verify identity per the policy above.
4. [ ] Fulfil the request. Document the action in the user's audit trail (account log, internal note) — what was done, when, by whom.
5. [ ] Reply to the requester confirming completion. For deletion, confirm the 30-day grace window (HON-481) and the date the data will be unrecoverable.
6. [ ] Close the thread. If the user has a follow-up complaint, restart from step 1.

If the request cannot be fulfilled within 30 days, send a notice to the requester before the 30-day deadline explaining the delay, the reason, and the new ETA (max 90 days from original receipt per Art. 12(3)). Do **not** silently drift past 30 days.

## Auto-reply canonical copy

The mail provider sends this auto-reply on every incoming message. The copy lives here so we can re-set it verbatim across providers without drift.

> Subject: We've received your message
>
> Hi,
>
> Thanks for writing in. We've received your message and will get back to you within 3 working days.
>
> If your message is a GDPR data-subject request (export, deletion, rectification, or complaint), we will acknowledge it within 72 hours and respond fully within 30 days, in line with GDPR Art. 12(3). You don't need to do anything more — we'll follow up directly.
>
> For anything urgent or related to a security or privacy concern, please mention it in your message so we can prioritise.
>
> — The Wobblepot team

Constraints on the copy:

- **Do not** claim 24/7 monitoring during beta.
- **Do not** promise a specific representative or named individual.
- **Do** mention the GDPR clocks if a DSR is suspected — sets expectations and counts as the statutory acknowledgement when the user's mail is unambiguously a DSR.

## Re-creating the auto-reply

If the mail provider changes (e.g. moving from a forwarder to a hosted mailbox):

1. Configure the new mailbox to deliver to the data controller.
2. Set the auto-reply with the canonical copy above, verbatim.
3. Send a test message from an external address. Verify the reply lands within a minute and contains the 3-working-day commitment.
4. Update this runbook if the provider's auto-reply UI imposes any deviations from the canonical copy.

## Cross-references

- `src/lib/support.ts` — shared `SUPPORT_EMAIL` constant
- "Surfaces that publish this address" above — the single canonical list of every place the address appears. Deliberately not re-enumerated here: two copies drift, and the one an operator misses is the one that keeps pointing at a dead address.
- [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) (HON-482) — escalate breach-related mail there; severity classification and the 72-hour AKI clock live in that runbook
- `docs/RUNBOOKS/status-page.md` — same support address; tone of incident-banner copy should match this runbook
- HON-457 — privacy policy that cites this email as the DSR contact
- HON-458 — GDPR data-export endpoint; cite when fulfilling export requests once it ships
- HON-481 — 30-day grace-window deletion; cite when fulfilling erasure requests once it ships
- AKI (Estonian DPA) — `https://www.aki.ee` is the user-facing entry point for complaints (verify URL when citing it)

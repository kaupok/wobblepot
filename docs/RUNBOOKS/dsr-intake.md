# Support inbox and GDPR DSR intake

Operator runbook for the public support address introduced in HON-487 and the privacy address the privacy policy publishes (HON-457). HON-643 made the privacy address the DSR intake.

## What this covers

- Where `privacy@wobblepot.com` (DSR intake) and `support@wobblepot.com` (general support) mail lands and who reads it.
- How to triage a GDPR data-subject request (DSR): export, deletion, rectification, complaint.
- The SLAs we have committed to in the privacy policy and the auto-reply.

This is not a customer-service playbook for general feature questions; it is the operational baseline for legal-grade requests and outage reports. General product questions follow the same SLA but do not require the identity-verification or classification steps below.

## DSR inbox

- **Address:** `privacy@wobblepot.com` — the sole DSR intake. It is the address the privacy policy gives data subjects.
- **Routing:** mail is delivered to the data-controller's monitored mailbox. Configuration lives outside the repository (DNS / mail provider). **A DSR that lands at `support@` instead** is forwarded to `privacy@` by the operator, and every DSR deadline below is counted from the original receipt at `support@`, not from the forward.
- **Operator follow-up (not verifiable from the repo):** confirm at the mail provider that `privacy@wobblepot.com` delivers to a monitored mailbox and that the auto-reply below is attached to it. Redo this check after any provider change.
- **Surfaces that publish this address:**
  - `src/app/(legal)/privacy/page.tsx` — all four contact spots in the privacy policy
  - `src/app/api/auth/user/route.ts` — the recovery contact in the account-deletion confirmation email
  - `src/app/bot/page.tsx` — the `/bot` crawler-opt-out contact (hardcodes the literal; HON-645)
  - `README.md` — the Security section, for privacy questions
  - `docs/RUNBOOKS/breach-notification.md` — the controller contact in the Art. 33 AKI notification
  - `docs/RUNBOOKS/gdpr-deletion.md` — the contact a user emails to cancel a pending deletion
  - This runbook — the **Address** line above
- **Regenerate this list; do not trust it.** The authoritative pair is `git grep -n 'privacy@wobblepot.com' -- ':!pnpm-lock.yaml'` and `git grep -ln PRIVACY_EMAIL -- 'src/**'`. `src/lib/support.ts` exports `PRIVACY_EMAIL` and `PRIVACY_EMAIL_HREF`; the `privacy/page.test.tsx` and `account-deletion-requested.test.ts` fixtures assert the literal.

## Support inbox

- **Address:** `support@wobblepot.com` — general support, outage reports, and security reports. Not a DSR intake; see "Routing" above for DSRs that arrive here.
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
  - _Not_ the privacy policy: it publishes `privacy@wobblepot.com` and rotates with `PRIVACY_EMAIL` — see "DSR inbox" above.
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

The 24-hour and 3-working-day commitments are softer than the GDPR clock and apply to all mail at either inbox, not just DSRs. The 72-hour and 30-day commitments only apply to GDPR DSRs and are statutory — do not silently miss them. "Receipt" is the first arrival at either inbox: a DSR forwarded from `support@` keeps its original receipt date.

## DSR types

A DSR is any user-initiated request to exercise rights under GDPR. The DSR inbox accepts all four; the user does not need to know which type to file under.

| Type                  | Right (GDPR Art.)                       | What we do                                                                                                                                                      |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export / portability  | Art. 15 (access), Art. 20 (portability) | Direct user to `/api/auth/user/export`, linked from the profile page (shipped, HON-458)                                                                         |
| Deletion / erasure    | Art. 17                                 | Direct user to Profile → "Delete account" to start the 30-day grace window (shipped, HON-481). Recovery and purge steps: [`gdpr-deletion.md`](gdpr-deletion.md) |
| Rectification         | Art. 16                                 | Edit in-app where possible; manual update otherwise. Document in the audit trail                                                                                |
| Complaint / objection | Art. 21, recital 141                    | Acknowledge; remind the user they may complain to their local supervisory authority (AKI for Estonia). Do not treat as adversarial — investigate and respond    |

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

1. [ ] If it arrived at `support@`, forward it to `privacy@` and record the original receipt date. Acknowledge within 72 hours of that date. Use a short reply: "We received your request and will respond within 30 days per GDPR Art. 12(3)." Note the receipt date in the reply.
2. [ ] Classify the request type (export / deletion / rectification / complaint). If ambiguous, ask one clarifying question; do not guess.
3. [ ] Verify identity per the policy above.
4. [ ] Fulfil the request. Document the action in the user's audit trail (account log, internal note) — what was done, when, by whom.
5. [ ] Reply to the requester confirming completion. For deletion, confirm the 30-day grace window (HON-481) and the date the data will be unrecoverable.
6. [ ] Close the thread. If the user has a follow-up complaint, restart from step 1.

If the request cannot be fulfilled within 30 days, send a notice to the requester before the 30-day deadline explaining the delay, the reason, and the new ETA (max 90 days from original receipt per Art. 12(3)). Do **not** silently drift past 30 days.

## Auto-reply canonical copy

The mail provider sends this auto-reply on every incoming message to both inboxes — `privacy@` because it is the DSR intake, `support@` because a DSR can still land there. The copy lives here so we can re-set it verbatim across providers without drift.

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

1. Configure both mailboxes (`privacy@`, `support@`) to deliver to the data controller.
2. Set the auto-reply on both with the canonical copy above, verbatim.
3. Send a test message to each address from an external address. Verify the reply lands within a minute and contains the 3-working-day commitment.
4. Update this runbook if the provider's auto-reply UI imposes any deviations from the canonical copy.

## Cross-references

- `src/lib/support.ts` — shared `PRIVACY_EMAIL` (DSR intake) and `SUPPORT_EMAIL` constants
- The two "Surfaces that publish this address" lists above — the single canonical list of every place each address appears. Deliberately not re-enumerated here: two copies drift, and the one an operator misses is the one that keeps pointing at a dead address.
- [`docs/RUNBOOKS/breach-notification.md`](breach-notification.md) (HON-482) — escalate breach-related mail there; severity classification and the 72-hour AKI clock live in that runbook
- `docs/RUNBOOKS/status-page.md` — same support address; tone of incident-banner copy should match this runbook
- HON-457 — privacy policy that publishes `privacy@wobblepot.com` as the DSR contact
- HON-458 — GDPR data-export endpoint (shipped); cite `/api/auth/user/export` when fulfilling export requests
- HON-481 — 30-day grace-window deletion (shipped); see [`gdpr-deletion.md`](gdpr-deletion.md) when fulfilling erasure requests
- AKI (Estonian DPA) — `https://www.aki.ee` is the user-facing entry point for complaints (verify URL when citing it)

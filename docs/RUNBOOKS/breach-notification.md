# Breach notification runbook (GDPR Art. 33/34)

Operator runbook for a personal-data breach. GDPR Art. 33 requires the data controller to notify the supervisory authority (AKI for Estonia) within **72 hours** of becoming _aware_ of a breach. Art. 34 requires notifying affected users when the breach is high-risk. This runbook is what the operator executes — paged at 2am, with no other context — step by step, without interpretation. Everything past this paragraph is procedure, not theory.

## Decision authority

The **data controller** owns every decision in this runbook. Operationally that is the **sole operator (the founder)** — there is no committee and no team lead. One person classifies severity and pulls the AKI-notify trigger, on purpose: a committee deliberating burns the 72-hour clock.

- **Severity classification** (Low / Medium / High) — the operator's call.
- **AKI-notify trigger** (Art. 33) and **user-notify trigger** (Art. 34) — the operator's call.
- **Out-of-hours contact:** `{{operator_out_of_hours_contact}}` — the operator's personal mobile. Keep the live number in the password manager (1Password), **not** in this repo. Anyone discovering a breach who is not the operator escalates to that number immediately, day or night.

If the operator is unreachable, the breach clock still runs — there is no "wait for sign-off" pause. Start the internal checklist below; the operator confirms classification when reachable.

## What counts as a breach

A personal-data breach is any incident leading to accidental or unlawful destruction, loss, alteration, unauthorized disclosure of, or access to personal data. Treat **any** of these as a suspected breach and start the checklist:

1. Unauthorized access to the database (Neon).
2. A leaked API key or connection string with database privilege (committed secret, exposed env var, key in logs).
3. An authentication bypass or broken access-control bug that exposes one user's data to another.
4. An accidentally-public endpoint returning personal data without auth.
5. Exposed prompts or logs containing personal data (Anthropic prompts, Vercel runtime logs, error payloads).
6. A subprocessor breach notification (Neon, Vercel, Resend, Anthropic, PostHog notify _us_ of a breach on their side).
7. Credential stuffing with **confirmed** account takeovers (not merely attempted logins).
8. Physical compromise of a device with access to production credentials (lost/stolen laptop or phone with live sessions).

When in doubt, treat it as a suspected breach and assess. Over-triaging costs an hour; under-triaging costs the 72-hour window.

## Severity classification

Three tiers. The trigger conditions are explicit so the call is fast.

| Tier       | Definition                                                                                                                                                     | AKI notification (Art. 33) | User notification (Art. 34)                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------- |
| **High**   | Identifying info (email + other PII, or credentials) exposed **and** high risk to subjects — financial harm, identity theft, account takeover, discrimination. | **Yes** — within 72h       | **Yes** — without undue delay                 |
| **Medium** | Personal data exposed, but low or uncertain risk to subjects (e.g. non-sensitive data, small scope, quickly contained, no evidence of exfiltration).           | **Yes** — within 72h       | **No**, unless reassessment escalates to High |
| **Low**    | Internal-only issue, **no** subject data exposed (e.g. an internal log leak with no PII, a near-miss caught before exposure).                                  | No statutory notification  | No                                            |

Notes:

- A leaked **password hash** counts toward High even though hashes are not plaintext — offline cracking enables account takeover.
- If you cannot tell whether risk is "low" or "high," classify **up** (Medium → High). The 72h clock does not reward optimism.
- A **Low**-tier incident is still documented and reviewed (post-mortem step) — it just carries no statutory notification.

## The 72-hour timer

1. The clock starts on **awareness** — the moment you know a breach probably happened. It does **not** wait for a finished investigation.
2. If, at the 72-hour mark, scope is still unknown, **submit the initial AKI notification with the facts you have** and mark it as preliminary. Follow up with the full picture within **5 working days**.
3. Do **not** delay past 72h to "be certain." A late notification is itself an Art. 33 violation; an incomplete-but-on-time notification is compliant.
4. Record the awareness timestamp the moment you start the checklist — it is the single most important fact in the whole process.

## Detection sources

When a breach is suspected, this is where the evidence lives. Check the ones relevant to the trigger.

| Source                | What to look for                                                                             | Where                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Vercel logs**       | Runtime errors, unexpected 500s, log-exfiltration patterns, anomalous request volume.        | Vercel dashboard → `honkadori` Team (team ID in the Vercel dashboard) → Logs            |
| **Neon console**      | Connection logs, audit trail, unusual query volume, connections from unexpected IPs.         | Neon console → Honkadori OÜ org (org ID in the Neon console; EU/Frankfurt) → Monitoring |
| **Resend dashboard**  | Spikes in send rate, unexpected recipients, delivery-failure bursts (a sign of a list dump). | Resend dashboard → Logs                                                                 |
| **Anthropic console** | API usage anomalies, unexpected key usage, spend spikes.                                     | Anthropic console → Honkadori OÜ org (org ID in the Anthropic console) → Usage          |
| **GitHub audit log**  | Secret exposure in commits, unexpected org/member changes, force-pushes.                     | GitHub → org settings → Audit log; plus secret-scanning alerts                          |
| **PostHog**[^posthog] | Event-traffic anomalies, unusual geography, session-replay of suspicious flows.              | PostHog Cloud EU (Frankfurt) → Activity / Web analytics                                 |

[^posthog]: PostHog is live (HON-474). Web-analytics + Core Web Vitals event coverage broadens once [HON-460](https://linear.app/honkadori/issue/HON-460) lands; until then PostHog detection is limited to the events already instrumented.

## Internal checklist

Work top to bottom. One checkbox per step. Copy this block into the incident log and tick as you go.

- [ ] **Isolate** — stop the bleeding. Rotate the leaked credential, revoke the exposed key, take the endpoint offline, or kill the session. Containment first.
- [ ] **Record awareness time** — the exact timestamp you became aware. Starts the 72h clock.
- [ ] **Assess** — use the detection sources above. What data, whose data, how much, for how long, evidence of exfiltration?
- [ ] **Classify severity** — Low / Medium / High per the table. The data controller's call.
- [ ] **Document** — write the facts in the incident log as you learn them (timeline, scope, affected categories, actions taken).
- [ ] **Notify AKI** (Medium/High) — submit within 72h of awareness using the template below. Preliminary if scope is unknown.
- [ ] **Notify affected users** (High) — send the Art. 34 email (see below) without undue delay.
- [ ] **Post-mortem** — within 1 week. Root cause, what failed, what changes prevent recurrence. Link it back to this runbook.

## AKI notification

**Legal basis:** GDPR Art. 33. **Authority:** Andmekaitse Inspektsioon (Data Protection Inspectorate), Tatari 39, 10134 Tallinn.

**How to submit** (verified 2026-06-02):

- **Entry point:** <https://www.aki.ee/meist/vota-uhendust/rikkumisteade> ("Rikkumisteade" — data-breach notification page).
- **Preferred:** the online portal (e-keskkond) at <https://saada.rik.ee> — authenticate with ID-card, Mobile-ID, or Smart-ID; the submission is saved to a dashboard for follow-up.
- **Alternative:** email **info@aki.ee** with AKI's official breach-notification form. AKI publishes an English-language Word template on the page above ("Rikkumisteate vorm andmetöötlejale inglise keelne") — download the current version at submission time rather than relying on a stale local copy.
- Re-verify the entry-point URL when you submit — agencies move subpaths.

**Template** — fill the placeholders and paste/attach. OÜ controller details were filled by [HON-457](https://linear.app/honkadori/issue/HON-457) and match the privacy policy (`src/lib/support.ts`); do not re-request them at breach time.

```markdown
## Personal data breach notification — GDPR Art. 33

**Controller**

- Legal name: Honkadori OÜ
- Registry code: 14197288
- Registered address: Peetri 11, 10415 Tallinn, Estonia
- Contact: privacy@wobblepot.com

**Awareness**

- Date/time we became aware: <ISO 8601 timestamp>
- Is this a preliminary notification (scope still under investigation)? <yes/no>

**Nature of the breach**

- What happened: <plain description — e.g. leaked DB credential, auth-bypass bug>
- Categories of personal data affected: <e.g. email addresses, names, password hashes, meal-plan data>
- Categories and approximate number of data subjects affected: <e.g. ~N registered users>
- Categories and approximate number of records affected: <count>

**Likely consequences**

- <e.g. risk of phishing, account takeover via cracked password hashes, identity theft>

**Measures taken / proposed**

- Containment: <e.g. credential rotated at <time>, endpoint disabled>
- Mitigation: <e.g. forced password reset, monitoring, user notification>
- Measures to prevent recurrence: <e.g. secret scanning, access-control test added>

**Subprocessor involvement (if any)**

- <which subprocessor, what they reported, reference to their breach notice>

**Data Protection contact for follow-up**

- privacy@wobblepot.com
```

If a **subprocessor** caused the breach, their DPA defines their notification obligations to us — the filed DPAs live in `compliance/dpas/` (Anthropic, Resend, Vercel, Neon); the PostHog DPA was executed via PandaDoc and the countersigned copy is held outside the repo — all tracked in [`compliance/README.md`](../../compliance/README.md). Cite their breach notice in the "Subprocessor involvement" field; we remain the controller and still owe AKI the Art. 33 notification.

## Affected-user notification (Art. 34)

Triggered only for **High**-severity breaches. The email is plain-language, honest, and jargon-free: what happened, what was exposed, what to do (change password, watch for phishing).

- **Template (code):** `src/lib/emails/breach-notification.ts` — `generateBreachNotificationEmail({ summary, impact, remediation, supportUrl })` returns `{ subject, html, text }`. Mirrors `reset-password.ts` (inline HTML, plain-text fallback).
- **Sending:** there is no automated send trigger. At breach time the operator writes the four fields and sends via an ad-hoc script through Resend. Keep `summary`/`impact`/`remediation` short and honest; no legalese.
- **Support link:** `supportUrl` becomes a clickable link in the email, so it **must be absolute** — a bare path or email won't resolve in a mail client. Use either `SUPPORT_EMAIL_HREF` from `src/lib/support.ts` (`mailto:support@wobblepot.com`) or the full status-page URL `https://wobblepot.com/status` (see [`status-page.md`](status-page.md)). Do **not** pass a relative `/status` or a bare `support@wobblepot.com`. Keep tone consistent with the status-page and DSR runbooks.

Suggested field content for a typical High breach:

- `summary`: "We're writing to let you know about a security incident that may have affected your account."
- `impact`: "Your email address and account details may have been exposed. Your payment information was not affected." (Adjust to the actual scope.)
- `remediation`: "As a precaution, please change your password and be cautious of emails asking for personal information."
- `supportUrl`: `https://wobblepot.com/status` (absolute) or `SUPPORT_EMAIL_HREF` (`mailto:support@wobblepot.com`).

## Ongoing commitment: quarterly dry-run

Once a quarter, the operator runs a hypothetical incident end-to-end through this runbook (no real systems touched), times it, and records the result in the appendix. Update the runbook with any gap found. This keeps the 2am-readiness real and is operational — it does not gate any feature work.

## Appendix: dry-run log

| Date       | Scenario simulated                                                                                       | Classified | Time to "AKI-ready" | Pass/Fail | Notes                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------- | ---------- | ------------------- | --------- | -------------------------------------------------------------------------------- |
| 2026-06-02 | Leaked Neon connection string (read access) committed publicly; User table queryable ~3h before rotation | High       | ~25 min             | Pass      | First dry-run, performed while authoring this runbook. Gaps found + fixed below. |

**Dry-run walkthrough (2026-06-02).** Hypothetical: a Neon read-only connection string is committed to a public commit and is live for ~3 hours before GitHub secret-scanning flags it.

1. **Isolate** — rotate the Neon credential in the Neon console (org ID in the Neon console); invalidate the exposed string. ✅ procedure clear.
2. **Record awareness** — timestamp = the secret-scanning alert time. ✅
3. **Assess** — Neon connection/query logs show whether the string was used and which tables were read. The User table holds emails, names, and password hashes. ✅ detection source actionable.
4. **Classify** — emails + **password hashes** readable → account-takeover risk → **High**. ✅ the "password hash counts toward High" note made this unambiguous.
5. **Document** — incident log started. ✅
6. **Notify AKI** — fill the template; submit via e-keskkond preliminary if read-scope is still being confirmed at 72h. ✅ URL verified live.
7. **Notify users** — High tier → send the Art. 34 email; `impact` names email + account details, advises password change + phishing vigilance. ✅
8. **Post-mortem** — root cause = secret committed; fix = secret scanning + pre-commit hook + key rotation policy. ✅

**Gaps found and fixed during the dry-run:**

- The severity table originally lacked guidance on password **hashes** — added the explicit "hashes count toward High" note so the classification call is unambiguous under pressure.
- The detection table points at each vendor console (Neon org / Vercel team / Anthropic org); the operator reads the ID there at incident time rather than from this document.
- Added the "operator unreachable → clock still runs" rule under Decision authority, since the dry-run surfaced the risk of stalling on sign-off.

**Result:** ~25 minutes from awareness to an AKI-ready notification draft — well inside 72h. Pass.

## Cross-references

- `src/lib/emails/breach-notification.ts` — the Art. 34 affected-user email template.
- [`compliance/README.md`](../../compliance/README.md) + `compliance/dpas/` — subprocessor DPAs that define subprocessor-breach obligations (HON-459).
- [`dsr-intake.md`](dsr-intake.md) — breach-related mail escalates here; shares the support contact and the "data controller" authority.
- [`database-recovery.md`](database-recovery.md) — if a recovery incident corrupts or exposes personal data, escalate to this runbook in parallel (the 72h clock runs independently).
- [`status-page.md`](status-page.md) — incident-banner copy and the breach email should share tone and the same support contact.
- [`CLAUDE.md`](../../CLAUDE.md) — destructive-command rule; containment never means destroying evidence on shared environments.
- AKI (Andmekaitse Inspektsioon) — <https://www.aki.ee/meist/vota-uhendust/rikkumisteade> (verify URL at submission time).

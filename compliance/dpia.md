# Data Protection Impact Assessment (lightweight)

|                           |                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Controller**            | Honkadori OÜ (registry code 14197288, Peetri 11, 10415 Tallinn, Estonia), operating as **Wobblepot**                                                             |
| **Date**                  | 2026-06-06                                                                                                                                                       |
| **Status**                | Approved 2026-06-06 (founder sign-off, HON-543)                                                                                                                  |
| **Scale at assessment**   | Pre-launch / invite-only EU beta; no production user data yet                                                                                                    |
| **Supervisory authority** | Andmekaitse Inspektsioon (AKI), Estonia                                                                                                                          |
| **Review triggers**       | Public (non-invite) launch · first enterprise customer · any new processor handling member dietary data · standalone child accounts · relevant AKI/EDPB guidance |

This is a deliberate lightweight assessment, not a formal GDPR Art. 35 DPIA. Screening result: the processing is not on AKI's Art. 35(4) mandatory-DPIA list and does not meet the EDPB WP248 "likely high risk" threshold at beta scale (no systematic monitoring, no large scale, no automated decisions with legal effect). We assess the two elevated-risk areas anyway because they touch children and health-adjacent data.

## Processing under assessment

Wobblepot plans family meals. The account-holding adult creates **household member profiles** — including children — containing names/labels, allergens, dietary restrictions, preferences, and macro targets. To generate meal plans, swaps, and preparation tips, this data is transmitted to **Anthropic, PBC** (US) as our processor (LLM inference). Full processor list, regions, and transfer safeguards: [`README.md`](./README.md); public disclosure at `/privacy/subprocessors`.

## Risk area 1 — children's data

**Model:** there are no child accounts. Member profiles are created and managed exclusively by the account-holding parent/guardian, who is the holder of parental responsibility and the one consenting. The privacy policy states: _"By adding a member under 16, you confirm that you are their parent or legal guardian and consent on their behalf."_ GDPR Art. 8 (child's own consent to an information society service) does not apply — the service is offered to the adult, not the child. The previously planned in-app acknowledgment checkbox (HON-467) was cancelled 2026-06-06 as evidentiary ceremony adding no legal basis; this DPIA reviewed and **concurs** with that decision.

**Risks & mitigations**

| Risk                              | Mitigation                                                                                                                                      | Residual |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Excess data collected on children | Data minimisation: no DOB, no photos, no identifiers beyond a display name — not even an under-16 flag is stored, only what meal planning needs | Low      |
| Non-parent adds a child's data    | Household membership is invite-gated by the account holder; profiles are only visible inside the household                                      | Low      |
| Child's data outlives relevance   | 30-day account-deletion purge; 24 h backup (PITR) window; members deletable individually at any time                                            | Low      |

## Risk area 2 — AI processing via Anthropic

**What is sent:** household preferences, allergens, member dietary data, pantry context — embedded in generation prompts. **What is not sent:** email addresses, passwords, payment data. Anthropic processes as a processor under a DPA (filed: `dpas/anthropic-dpa-2026-06-02.pdf`) and **does not train models on the data**. Transfer basis: EU SCCs Module 2 + UK Addendum + EU-US Data Privacy Framework.

**Allergen data is the crux.** An allergy is a medical condition, so allergen fields are plausibly Art. 9 "data concerning health" — for _all_ members, adults included. Our position:

- Providing allergen data is **optional and user-initiated**, for the single, clearly stated purpose of meal planning; we treat that affirmative act, against the policy's explicit AI-processing disclosure, as Art. 9(2)(a) explicit consent.
- Necessity/proportionality: allergen-aware planning is the core safety feature of the product — the data cannot be omitted from prompts without defeating the user's purpose.
- The honest gap: a dedicated affirmative notice at the point of entering allergen data would make the explicit-consent claim more robust. At beta scale we accept the residual risk; **recommended hardening** (pre-public-launch): a one-line affirmation in the member form where allergens are entered — for all members, not only under-16s, answering the revisit-question left by HON-467's cancellation.

**Risks & mitigations**

| Risk                                           | Mitigation                                                                                                                   | Residual                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Health-adjacent data in a US processor's hands | DPA + no-training clause + SCCs M2 + UK Addendum + DPF; prompts carry no direct identifiers (no email/full account identity) | Low–medium                   |
| Art. 9 basis challenged                        | Optional provision + explicit policy disclosure; hardening recommended above; revisit on guidance                            | Medium → low after hardening |
| AI output leaking another household's data     | Stateless inference per request; no cross-household context is ever included in prompts                                      | Low                          |

## Conclusion

Processing may proceed. Both risk areas are adequately mitigated at current scale; one recommendation is open (allergen-entry affirmation, pre-public-launch). Re-run this assessment on any review trigger above.

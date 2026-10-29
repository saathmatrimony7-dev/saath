# Runbook: incident response (DESIGN.md §12.8)

**Regulatory clocks (hard):** CERT-In incident report **within 6 hours**
(CERT-In Directions 2022); ICT logs kept **180 days** in India, clocks on
NTP. DPDP: breach notification to the Data Protection Board and affected
users as per the Rules.

## Severity matrix

| Sev | Example | Response |
|-----|---------|----------|
| S1 | Data breach, LLM data leak, payment fraud at scale | Full IR, 6-h CERT-In clock, comms plan |
| S2 | Account-takeover wave, scam campaign, region outage | On-call + strike team, daily updates |
| S3 | Single-user harm, isolated abuse spike | Normal queue + safety review |

## Playbooks (all end with a post-incident review within 5 business days)

- **Data breach:** contain (revoke tokens/keys, isolate service) → assess
  scope from audit logs + `llm_calls` → CERT-In within 6 h → DPDP notices →
  rotate exposed secrets → review.
- **Account-takeover wave:** raise OTP/risk thresholds (config, not code),
  force session revocation for flagged cohorts, enable JIT review of A3
  risk scores.
- **Scam campaign:** A9 label review → bulk flag → `restrict_account` soft
  limits → human bans only.
- **Payment fraud:** webhook replay audit (`webhook_events` idempotency
  log), Razorpay dispute flow, entitlement reversals via the billing
  service context.
- **LLM data leak:** cut the LLM gateway circuit breaker
  (`LLM_GLOBAL_CIRCUIT_BREAKER_TOKENS`), pull redaction samples from
  Langfuse (redacted prompts only), review the gateway redaction rules.
- **Outage:** fail static, drain queues, DB restore per dr-restore.md.

## Notification template (pre-drafted)

Keep a filled-in copy per incident: what happened, when detected, scope
(users/classes affected), containment, regulatory notifications sent
(CERT-In reference number), follow-ups.

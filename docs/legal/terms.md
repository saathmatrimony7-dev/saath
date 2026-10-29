# Terms of use & platform rules (Saath)

**Version:** 2026-10-23.v1 (review alongside docs/legal/privacy-notice.md).

## Platform rules (enforced)

1. **Legal marriage age only:** users below the configurable age gate
   (women 18, men 21) cannot register.
2. **No contact-detail leakage:** phone numbers, emails, links and handles
   are blocked in chat until both users opt in to share contacts; calls are
   masked through the provider bridge.
3. **No fraud or solicitation:** money requests, off-platform pressure and
   scam scripts are classified by the safety pipeline; verified cases lead
   to restrictions (human review before any ban).
4. **Respectful conduct:** harassment and sexual content are flagged and
   escalated.
5. **One person, one account:** phone number is tied to the account; KYC
   duplicates are cross-checked.

## Subscriptions & refunds (Consumer Protection E-Commerce Rules)

- Prices are GST-inclusive; GST invoices are issued per payment.
- Self-serve cancellation in two clicks (`POST /v1/subscriptions/:id/cancel`);
  the plan stays active to the end of the paid period — no dark patterns.
- Refund disputes are handled by a human (support/grievance route).

## Grievance Officer (IT Intermediary Rules 2021)

- Contact: grievance@saath.example (production address published at launch).
- Acknowledgement within 24 hours; resolution within 30 days (SLA enforced
  by the grievance queue, `GET /v1/admin/grievances`).

## Takedown

Report any unlawful content via `POST /v1/users/:id/report`; reviewed under
the safety case workflow with an audit trail.

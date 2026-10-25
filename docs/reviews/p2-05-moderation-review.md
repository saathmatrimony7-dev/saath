# P2-05 review — A9 moderation (security + privacy)

Scope: Python `moderation` package (A9Classifier + strict verdict schema + versioned prompt), service-token `/internal/moderation/classify` route, labelled corpus + eval runner, Core `ModerationAgentClient` (mock/http) wiring report details → a9 safety cases, real-Claude eval report.

## Security — PASS

| Sev | Finding | Disposition |
|-----|---------|-------------|
| — | Route is service-token guarded (401 tested); strict body (422 on unknown fields); labels validated against the closed set server-side in Core before acting | No issue |
| — | Input bounded (2000 chars); verdict tokens capped (300); one repair retry | No issue |
| — | Injection-in-text covered by corpus item en15 (embedded "ignore previous instructions") — classified by content in the real run (detected) | No issue |
| — | Classification failure can never break reporting (log + continue, tested with mock) | No issue |

## Privacy — PASS

- The verdict that crosses service boundaries is labels + ≤5 short signal keywords — never the input text (schema `extra=forbid`; route test asserts the text is not echoed).
- Report details reach A9 only (internal network path), never a third party beyond the approved Claude call through the gateway (redaction + budgets + audit per ADR-0008 pattern).
- Confidence gate (≥0.7) before any case opens; `safe` never opens a case (tested).
- Real-run metrics: recall 90.0% (exact-label; 95% on scam-family detection since en02/hi08 were caught as scam_script), precision 100% on safe negatives — **exit criterion 2 PASS** (report committed under `services/agents/evals/reports/`).

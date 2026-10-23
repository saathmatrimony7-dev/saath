# ADR-0005: Terraform plan-only until AWS accounts exist; GitHub repo pending

**Status:** accepted · **Date:** 2026-10-21 · **Decided with:** owner (P0 Q1, Q4)

## Context

AWS accounts (dev/staging/security-logging) and the GitHub organisation/repo will be created later by the owner.

## Decision

- Terraform modules + envs are complete and validated locally (`fmt -check`, `validate`) and in CI; **nothing is applied**. Backend blocks contain `saath-tfstate-CHANGE_ME` placeholders; `infra/terraform/bootstrap/` creates the state bucket/lock table when accounts exist; cutover steps are in `infra/terraform/README.md`.
- CI workflows are committed but can't run until the repo is pushed to GitHub; all checks were executed locally instead (see `docs/p0-exit-evidence.md`).
- GitHub OIDC → AWS deploy roles land with the accounts (no static keys anywhere, per §12.5).

## Consequences

- No cloud cost incurred during P0/P1.
- "CI green" for P0 means: the full check suite passes locally and the CI definition is complete and ready to run.
- When accounts exist: run bootstrap, fill backend bucket names, push to GitHub, verify CI green, enable branch protection.

# Saath Terraform

Environments: `envs/dev`, `envs/staging` (prod comes with P5 hardening). Region is **ap-south-1 only** (data residency, DESIGN.md §2.1); DR copies go to ap-south-2 later.

## Status: plan-only

AWS accounts do not exist yet (owner decision, P0 Q1). CI runs `terraform fmt -check` and `terraform validate` only — nothing is applied. Once accounts exist:

1. **Bootstrap state** (per account, admin credentials):
   ```bash
   cd infra/terraform/bootstrap && terraform init && terraform apply
   ```
2. Copy the `state_bucket` output into `envs/*/versions.tf` backend blocks (replace `saath-tfstate-CHANGE_ME`).
3. Create the GitHub OIDC provider + deploy role (to be added as `modules/github-oidc` when CI deploys begin — no static AWS keys in GitHub, §12.5).
4. `terraform plan` runs on PRs; `apply` is manual/approved for prod.

## Modules

| Module       | Contents                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `network`    | VPC, public/private/isolated subnet tiers, NAT, least-privilege SGs (ALB ↔ ECS ↔ data)                                                     |
| `kms`        | CMKs per data class (`c2c3`, `c4`, `logs`), rotation on; C4 key policy restricted to the crypto-module role                                |
| `database`   | RDS Postgres 16 (+ pgvector via migration), isolated subnets, KMS, PITR, `rds.force_ssl=1`, master password auto-stored in Secrets Manager |
| `cache`      | ElastiCache Redis 7, TLS + AUTH token (generated, stored in Secrets Manager)                                                               |
| `cloudtrail` | Multi-region CloudTrail → S3 Object Lock (COMPLIANCE, 365d ≥ CERT-In 180d), GuardDuty, Security Hub                                        |

## Local validation (no AWS needed)

```bash
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform/envs/dev init -backend=false && terraform -chdir=infra/terraform/envs/dev validate
terraform -chdir=infra/terraform/envs/staging init -backend=false && terraform -chdir=infra/terraform/envs/staging validate
```

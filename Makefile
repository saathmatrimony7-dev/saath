.PHONY: security security-python db-up db-down

# Security scans (canonical entrypoint, also runs in CI).
# Requires: gitleaks, semgrep, trivy on PATH.
security:
	gitleaks detect --source . --redact
	semgrep scan --config p/owasp-top-ten --config p/secrets --error --exclude node_modules --exclude .venv .
	trivy fs --scanners vuln,secret,misconfig --skip-dirs node_modules,.venv,.git .
	pnpm audit --prod
	$(MAKE) security-python

security-python:
	cd services/agents && uv run pip-audit
	cd services/matching && uv run pip-audit

# Local dev datastores (Docker). Cloud envs use Terraform-managed RDS/ElastiCache.
db-up:
	docker compose -f infra/docker/docker-compose.yml up -d

db-down:
	docker compose -f infra/docker/docker-compose.yml down

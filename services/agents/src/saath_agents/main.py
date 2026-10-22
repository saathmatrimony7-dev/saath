"""FastAPI app for the agents service (internal only — never public).

P0-10 skeleton: health endpoint + a scope-check probe proving the scoped-token
middleware. Real agents (A1–A11) plug in from P1 onward.

Security posture (§6.0, §12.6):
- every agent route requires a valid scoped token (HMAC-signed, ≤15 min TTL)
- the token binds agent + acting_for_user_id; the route enforces both
- no DB credentials exist in this service — agents act via /internal/tools/* on
  the Core API with this token
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

from .config import AgentConfig, load_config
from .tokens import ScopedTokenClaims, ScopedTokenError, verify_token


def require_scoped_token(
    request: Request,
    x_agent_token: str | None = Header(default=None),
) -> ScopedTokenClaims:
    """Verifies the HMAC scoped token against app config. Use as a dependency
    on every agent route; enforce tool/user scope inside the handler."""
    if not x_agent_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing agent token")
    cfg: AgentConfig = request.app.state.config
    try:
        return verify_token(cfg.agent_token_secret, x_agent_token)
    except ScopedTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc


def create_app(config: AgentConfig | None = None) -> FastAPI:
    app = FastAPI(title="saath-agents", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config or load_config()

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/internal/scope-check")
    def scope_check(
        claims: ScopedTokenClaims = Depends(require_scoped_token),
    ) -> dict[str, object]:
        """Probe: echoes the token's scope so callers can verify binding works.
        Returns no user data — claims only."""
        return {
            "agent": claims.agent,
            "acting_for_user_id": claims.acting_for_user_id,
            "tools": claims.tools,
            "exp": claims.exp,
        }

    return app

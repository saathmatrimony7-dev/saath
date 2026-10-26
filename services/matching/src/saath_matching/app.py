"""FastAPI app for the matching service (internal only — never public).

P3-02: health endpoint + the snapshot-embedding endpoint Core calls after A2
normalises a profile. Mirrors services/agents/src/saath_agents/main.py.

Security posture:
- every /internal route requires the shared internal service token
  (HMAC-compared, mirroring services/agents)
- the request body is a strict ProfileSnapshot (rule 3/rule 6): extra fields
  422, and there is no field anywhere in the schema that can carry raw user text
- no DB credentials exist in this service
"""

from __future__ import annotations

import hmac

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status

from .config import MatchingConfig, load_config
from .embeddings.provider import EmbeddingProvider, build_embedding_provider
from .snapshots import ProfileSnapshot
from .summary_builder import embed_snapshot


def require_service_token(
    request: Request, x_internal_token: str | None = Header(default=None)
) -> None:
    """Core API -> matching service calls carry the internal service token."""
    cfg: MatchingConfig = request.app.state.config
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, cfg.internal_service_token
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token")


def create_app(config: MatchingConfig | None = None) -> FastAPI:
    app = FastAPI(title="saath-matching", docs_url=None, redoc_url=None, openapi_url=None)
    cfg = config or load_config()
    app.state.config = cfg
    app.state.provider: EmbeddingProvider = build_embedding_provider(
        cfg.embedding_provider, node_env=cfg.node_env
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/internal/embed/profile")
    def embed_profile(
        request: Request,
        body: ProfileSnapshot,
        _token: None = Depends(require_service_token),
    ) -> dict[str, object]:
        """Embed one normalised profile snapshot (A2-system-normalised data only)."""
        provider: EmbeddingProvider = request.app.state.provider
        result = embed_snapshot(body, provider)
        return result.model_dump()

    return app

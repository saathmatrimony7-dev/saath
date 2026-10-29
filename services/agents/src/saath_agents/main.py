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

import hmac

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from .config import AgentConfig, load_config
from .coordinator import A8Coordinator, CoordinatorFacts
from .family import A7FamilyLiaison, FamilySignalItem
from .llm_gateway_client import LlmGatewayClient
from .onboarding.engine import A1OnboardingEngine, InterviewState
from .onboarding.tools_client import CoreToolsPort
from .moderation import A9Classifier
from .screening import A6ScreeningBroker, ScreeningCoreClient, ScreeningThresholds
from .batch import default_batch_date, run_batch
from .tokens import ScopedTokenClaims, ScopedTokenError, verify_token


class OnboardingTurnBody(BaseModel):
    """Module level (postponed annotations can't resolve closure-local models)."""

    model_config = {"extra": "forbid"}

    sessionId: str
    userId: str
    locale: str = "en"
    turnCount: int = Field(ge=0)
    userText: str = Field(min_length=1, max_length=5000)
    history: list[dict[str, str]] = Field(default_factory=list)


class ModerationClassifyBody(BaseModel):
    """A9 classify request (P2-05). Service-token route; no user binding."""

    model_config = {"extra": "forbid"}

    text: str = Field(min_length=1, max_length=2000)
    context: str = Field(default="report", max_length=32)  # report | chat | bio


class ScreeningRunBody(BaseModel):
    """A6 screening run (P3-05). Service-token route; the broker is neutral."""

    model_config = {"extra": "forbid"}

    aUserId: str
    bUserId: str


class BatchRunBody(BaseModel):
    """Nightly batch trigger (P3-07). Service-token route; returns stats only."""

    model_config = {"extra": "forbid"}

    batchDate: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class CoordinatorSuggestBody(BaseModel):
    """A8 coordinator suggestions (P4-09). Service-token route. Inputs are
    closed-vocabulary conversation facts only — chat bodies (C4) never
    enter this payload."""

    model_config = {"extra": "forbid"}

    userId: str
    conversationId: str
    locale: str = "en"
    origin: str = "mutual"
    contactShared: bool = False


class FamilySummariseBody(BaseModel):
    """A7 family digest (P3-10). Service-token route; STRUCTURED SIGNALS ONLY —
    no comments ever enter this payload (no C4 material crosses to the LLM)."""

    model_config = {"extra": "forbid"}

    ownerId: str
    locale: str = "en"
    items: list[FamilySignalItem] = Field(default_factory=list)


def require_service_token(request: Request, x_internal_token: str | None = Header(default=None)) -> None:
    """Core API -> agents service calls carry the internal service token."""
    cfg: AgentConfig = request.app.state.config
    if not x_internal_token or not hmac.compare_digest(
        x_internal_token, cfg.internal_service_token
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid service token")


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

    @app.post("/internal/onboarding/turn")
    def onboarding_turn(
        body: OnboardingTurnBody,
        _token: None = Depends(require_service_token),
    ) -> dict[str, str]:
        """One A1 interview turn. Core owns persistence; we own the conversation."""
        cfg: AgentConfig = app.state.config
        engine = A1OnboardingEngine(
            llm=LlmGatewayClient(cfg),
            tools=CoreToolsPort(cfg),
            max_turns=int(getattr(cfg, "onboarding_max_turns", 25)),
        )
        state = InterviewState(
            session_id=body.sessionId,
            user_id=body.userId,
            locale=body.locale if body.locale in ("en", "hi", "ta") else "en",
            turn_count=body.turnCount,
            history=[m for m in body.history if m.get("role") in ("user", "assistant")],
        )
        out = engine.take_turn(state, body.userText)
        return {"replyText": out.reply_text, "status": out.status}

    @app.post("/internal/moderation/classify")
    def moderation_classify(
        body: ModerationClassifyBody,
        _token: None = Depends(require_service_token),
    ) -> dict[str, object]:
        """A9: classify user-generated text. Returns labels only — never the
        input text back (rule 6/8 hygiene)."""
        cfg: AgentConfig = app.state.config
        verdict = A9Classifier(llm=LlmGatewayClient(cfg)).classify(body.text)
        return verdict.model_dump()

    @app.post("/internal/screening/run")
    def screening_run(
        body: ScreeningRunBody,
        _token: None = Depends(require_service_token),
    ) -> dict[str, object]:
        """A6: full §7.3 protocol for one pair. Returns the strict verdict
        JSON only — no snapshot text, no advocate payloads (rule 6)."""
        cfg: AgentConfig = app.state.config
        thresholds = ScreeningThresholds(
            score_compatible=cfg.screening_score_compatible,
            score_partial=cfg.screening_score_partial,
            stage2_max_topics=cfg.screening_stage2_max_topics,
        )
        broker = A6ScreeningBroker(
            llm=LlmGatewayClient(cfg),
            tools=ScreeningCoreClient(cfg),
            thresholds=thresholds,
        )
        verdict = broker.screen_pair(body.aUserId, body.bUserId)
        return verdict.model_dump(mode="json")

    @app.post("/internal/batch/run")
    def batch_run(
        body: BatchRunBody,
        _token: None = Depends(require_service_token),
    ) -> dict[str, object]:
        """Runs the full §8 nightly batch for one date (idempotent re-runs).
        Returns aggregate stats only — no per-user data."""
        cfg: AgentConfig = app.state.config
        stats = run_batch(cfg, body.batchDate or default_batch_date())
        return stats

    @app.post("/internal/coordinator/suggest")
    def coordinator_suggest(
        body: CoordinatorSuggestBody,
        _token: None = Depends(require_service_token),
    ) -> dict[str, object]:
        """A8: icebreakers for the caller's own user. Suggestions only — the
        coordinator never sends anything to the other person (§6.1 A8)."""
        facts = CoordinatorFacts(origin=body.origin, contact_shared=body.contactShared)
        suggestion = A8Coordinator().suggest(locale=body.locale, facts=facts)
        return {"icebreakers": suggestion.icebreakers, "slots": suggestion.slots}

    @app.post("/internal/family/summarise")
    def family_summarise(
        body: FamilySummariseBody,
        _token: None = Depends(require_service_token),
    ) -> dict[str, str]:
        """A7: digest of structured family feedback in the owner's language.
        Returns the summary text only."""
        cfg: AgentConfig = app.state.config
        liaison = A7FamilyLiaison(llm=LlmGatewayClient(cfg))
        summary = liaison.summarise(
            owner_id=body.ownerId,
            locale=body.locale if body.locale in ("en", "hi", "ta") else "en",
            items=body.items,
        )
        return {"summary": summary}

    return app

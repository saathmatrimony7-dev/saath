"""Runtime configuration for the agents service.

All values from the environment; secrets from .env.local (git-ignored) locally
or AWS Secrets Manager in cloud. No defaults for secrets.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class AgentConfig:
    # HMAC secret for scoped agent tokens (services/agents <-> Core API).
    agent_token_secret: str
    # Core API base URL + internal service token for /internal/* calls.
    core_api_url: str
    internal_service_token: str
    # Model names are config, never code (rule 13).
    llm_model_small: str = "claude-haiku-5-5"
    llm_model_mid: str = "claude-sonnet-5-5"
    llm_model_large: str = "claude-opus-5-5"
    # A1 interview turn cap (DESIGN.md Q3: 25 turns then extract + confirm).
    onboarding_max_turns: int = 25
    # A6 screening broker Stage-3 combine (rule 13: thresholds are config).
    screening_score_compatible: float = 0.75
    screening_score_partial: float = 0.45
    screening_stage2_max_topics: int = 12
    # A4 matchmaker + nightly batch (DESIGN.md §8; rule 13: config not code).
    matching_stage2_max_per_user: int = 30
    matching_daily_publish_count: int = 3
    matching_exposure_daily_cap: int = 5
    matching_final_weight_screening: float = 0.7
    matching_final_weight_prerank: float = 0.3
    # A4 explanations (P3-09, §8 step 9; mid tier via the LLM Gateway).
    explanation_max_chars: int = 280
    explanation_max_claims: int = 3
    explanation_max_tokens: int = 220
    # Nightly batch runner concurrency (Q4: script/trigger now, scheduler P5).
    batch_workers: int = 8


def load_config(env: dict[str, str] | None = None) -> AgentConfig:
    e = env if env is not None else os.environ
    missing = [
        k
        for k in ("AGENT_TOKEN_SECRET", "CORE_API_URL", "INTERNAL_SERVICE_TOKEN")
        if not e.get(k)
    ]
    if missing:
        raise RuntimeError(f"missing required config keys: {', '.join(missing)}")
    return AgentConfig(
        agent_token_secret=e["AGENT_TOKEN_SECRET"],
        core_api_url=e["CORE_API_URL"].rstrip("/"),
        internal_service_token=e["INTERNAL_SERVICE_TOKEN"],
        llm_model_small=e.get("LLM_MODEL_SMALL", "claude-haiku-5-5"),
        llm_model_mid=e.get("LLM_MODEL_MID", "claude-sonnet-5-5"),
        llm_model_large=e.get("LLM_MODEL_LARGE", "claude-opus-5-5"),
        onboarding_max_turns=int(e.get("ONBOARDING_MAX_TURNS", "25")),
        screening_score_compatible=float(e.get("SCREENING_SCORE_COMPATIBLE", "0.75")),
        screening_score_partial=float(e.get("SCREENING_SCORE_PARTIAL", "0.45")),
        screening_stage2_max_topics=int(e.get("SCREENING_STAGE2_MAX_TOPICS", "12")),
        matching_stage2_max_per_user=int(e.get("MATCHING_STAGE2_MAX_PER_USER", "30")),
        matching_daily_publish_count=int(e.get("MATCHING_DAILY_PUBLISH_COUNT", "3")),
        matching_exposure_daily_cap=int(e.get("MATCHING_EXPOSURE_DAILY_CAP", "5")),
        matching_final_weight_screening=float(e.get("MATCHING_FINAL_WEIGHT_SCREENING", "0.7")),
        matching_final_weight_prerank=float(e.get("MATCHING_FINAL_WEIGHT_PRERANK", "0.3")),
        explanation_max_chars=int(e.get("EXPLANATION_MAX_CHARS", "280")),
        explanation_max_claims=int(e.get("EXPLANATION_MAX_CLAIMS", "3")),
        explanation_max_tokens=int(e.get("EXPLANATION_MAX_TOKENS", "220")),
        batch_workers=int(e.get("BATCH_WORKERS", "8")),
    )

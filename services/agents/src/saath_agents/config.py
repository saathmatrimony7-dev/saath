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
    )

"""CLI entry point for the nightly batch (P3-07, Q4: script trigger).

  uv run python -m saath_agents.batch --date 2026-10-27

Env (see config.load_config): AGENT_TOKEN_SECRET, CORE_API_URL,
INTERNAL_SERVICE_TOKEN, plus MATCHING_* tuning. The HTTP trigger lives on
the agents service: POST /internal/batch/run (service token).
"""

from __future__ import annotations

import argparse
import json

from ..config import load_config
from .runner import default_batch_date, run_batch


def main() -> int:
    parser = argparse.ArgumentParser(description="Saath nightly match batch")
    parser.add_argument("--date", default=default_batch_date(), help="batch date (YYYY-MM-DD)")
    args = parser.parse_args()
    stats = run_batch(load_config(), args.date)
    print(json.dumps(stats))  # final line: compact JSON for benchmark tooling
    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

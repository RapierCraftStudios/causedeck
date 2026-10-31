"""Environment schema for Indian Kanoon integration.

Code never blocks on credentials: every integration has a mock or console
provider and an env schema that boots without secrets present.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class IndianKanoonConfig:
    """Configuration for the Indian Kanoon API integration.

    Credentials are optional at boot time. When absent, the mock/console
    provider is used so the application still starts.
    """

    api_token: Optional[str] = field(default=None)
    base_url: str = field(default="https://api.indiankanoon.org")
    monthly_budget_inr: Optional[float] = field(default=None)

    @classmethod
    def from_env(cls) -> "IndianKanoonConfig":
        token = os.getenv("INDIAN_KANOON_API_TOKEN")
        base_url = os.getenv("INDIAN_KANOON_BASE_URL", "https://api.indiankanoon.org")
        budget_raw = os.getenv("INDIAN_KANOON_MONTHLY_BUDGET_INR")
        budget = float(budget_raw) if budget_raw else None
        return cls(
            api_token=token,
            base_url=base_url,
            monthly_budget_inr=budget,
        )

    @property
    def enabled(self) -> bool:
        """Whether live Indian Kanoon calls are permitted."""
        return bool(self.api_token)

    @property
    def link_out_only(self) -> bool:
        """When commercial use is unconfirmed, only link-out mode is allowed."""
        # Commercial-use confirmation is tracked out-of-band (issue #114).
        # Until confirmed, treat as link-out-only to be safe.
        return not self.enabled or True  # conservative: always link-out until confirmed


# Module-level singleton populated from environment at import time.
indian_kanoon_config = IndianKanoonConfig.from_env()
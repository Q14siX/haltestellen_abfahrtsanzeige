"""Track health of existing departure requests without making additional calls."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class RequestHealth:
    """Volatile per-stop metrics; reset when the integration reloads."""

    attempts: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    consecutive_failures: int = 0
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    last_duration_ms: float | None = None
    last_http_status: int | None = None
    last_error_category: str | None = None
    last_request_succeeded: bool | None = None

    def record_success(self, elapsed_seconds: float, *, now: datetime | None = None) -> None:
        """Record a fully parsed and converted departure response."""
        timestamp = now or datetime.now(timezone.utc)
        self.attempts += 1
        self.successful_requests += 1
        self.consecutive_failures = 0
        self.last_attempt_at = timestamp
        self.last_success_at = timestamp
        self.last_duration_ms = round(max(0, elapsed_seconds) * 1000, 1)
        self.last_http_status = 200
        self.last_error_category = None
        self.last_request_succeeded = True

    def record_failure(
        self,
        elapsed_seconds: float,
        *,
        http_status: int | None = None,
        category: str = "request",
        now: datetime | None = None,
    ) -> None:
        """Record a failed request without retaining exception text or stop IDs."""
        timestamp = now or datetime.now(timezone.utc)
        self.attempts += 1
        self.failed_requests += 1
        self.consecutive_failures += 1
        self.last_attempt_at = timestamp
        self.last_failure_at = timestamp
        self.last_duration_ms = round(max(0, elapsed_seconds) * 1000, 1)
        self.last_http_status = http_status if isinstance(http_status, int) and 100 <= http_status <= 599 else None
        # Bounded fixed vocabulary: no raw HTTP bodies, URLs or error strings.
        self.last_error_category = category if category in {"network", "http", "api", "data", "request"} else "request"
        self.last_request_succeeded = False

    def snapshot(self) -> dict:
        """Return a JSON-safe, privacy-preserving snapshot."""
        def iso(value: datetime | None) -> str | None:
            return value.isoformat() if value else None

        return {
            "attempts": self.attempts,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "consecutive_failures": self.consecutive_failures,
            "last_attempt_at": iso(self.last_attempt_at),
            "last_success_at": iso(self.last_success_at),
            "last_failure_at": iso(self.last_failure_at),
            "last_duration_ms": self.last_duration_ms,
            "last_http_status": self.last_http_status,
            "last_error_category": self.last_error_category,
            "last_request_succeeded": self.last_request_succeeded,
        }

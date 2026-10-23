"""Adaptive, rate-conscious departure polling policy (pure logic; no Home Assistant imports)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .const import (
    DEFAULT_REFRESH_MODE, REFRESH_MODE_ADAPTIVE, REFRESH_MODE_ECONOMY,
    REFRESH_MODE_FIXED, UPDATE_INTERVAL,
)
from .departures import parse_time


@dataclass(frozen=True)
class PollDecision:
    interval: timedelta
    reason: str


def next_successful_poll(
    data: dict[str, Any] | None,
    mode: str = DEFAULT_REFRESH_MODE,
    *,
    now: datetime | None = None,
) -> PollDecision:
    """Select cadence using the nearest *usable* future departure.

    Countdown values still update locally every minute; the provider is not
    queried for every time change. Cancelled services cannot set the cadence.
    """
    if mode == REFRESH_MODE_FIXED:
        return PollDecision(UPDATE_INTERVAL, "fixed")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    seconds: float | None = None
    for row in (data or {}).get("abfahrten", []):
        if not isinstance(row, dict) or row.get("ausfall"):
            continue
        departure = parse_time(row.get("abfahrt"))
        if departure is None:
            continue
        remaining = (departure - now).total_seconds()
        if remaining < 0:
            continue
        if seconds is None or remaining < seconds:
            seconds = remaining
    economy = mode == REFRESH_MODE_ECONOMY
    if seconds is None:
        return PollDecision(timedelta(minutes=12 if economy else 10), "no_departures")
    if seconds <= 5 * 60:
        return PollDecision(timedelta(minutes=2 if economy else 1), "imminent")
    if seconds <= 15 * 60:
        return PollDecision(timedelta(minutes=4 if economy else 2), "soon")
    if seconds <= 45 * 60:
        return PollDecision(timedelta(minutes=6 if economy else 4), "later")
    return PollDecision(timedelta(minutes=12 if economy else 10), "distant")


def next_failed_poll(
    consecutive_failures: int,
    http_status: int | None = None,
    retry_after_seconds: int | None = None,
) -> PollDecision:
    """Bounded exponential backoff; 429 gets at least a ten-minute pause."""
    failures = max(1, int(consecutive_failures))
    minutes = min(30, 5 * 2 ** min(failures - 1, 3))
    if http_status == 429:
        minutes = max(10, minutes)
    seconds = minutes * 60
    if retry_after_seconds is not None:
        seconds = max(seconds, min(86400, max(0, int(retry_after_seconds))))
    return PollDecision(
        timedelta(seconds=seconds),
        "server_retry_after" if retry_after_seconds is not None and seconds > minutes * 60
        else "rate_limited" if http_status == 429 else "error_backoff",
    )

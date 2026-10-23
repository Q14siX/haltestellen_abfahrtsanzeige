"""Pure, side-effect-free departure automation evaluation.

Kept separate from Home Assistant for deterministic regression tests. A rule
instance belongs to one automation; it never changes a user's sensor data.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .departures import parse_time

DEPARTURE_SOON = "departure_soon"
DELAY_REACHED = "delay_reached"
TRIP_CANCELLED = "trip_cancelled"


def _trip_key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    """Identify a stop visit, even across the provider's realtime updates."""
    return (
        str(row.get("fahrt_id") or "").strip(),
        str(row.get("plan_abfahrt") or row.get("abfahrt") or ""),
        str(row.get("linie") or "").strip(),
        str(row.get("ziel") or "").strip(),
    )


def _matches(row: dict[str, Any], line: str, destination: str) -> bool:
    actual_line = str(row.get("linie") or "").strip().casefold()
    actual_destination = str(row.get("ziel") or "").strip().casefold()
    return (
        (not line or actual_line == line.casefold())
        and (not destination or destination.casefold() in actual_destination)
    )


def _delay(row: dict[str, Any]) -> int | None:
    value = row.get("verspaetung_minuten")
    if isinstance(value, bool):
        return None
    return round(value) if isinstance(value, (int, float)) else None


class DepartureRuleMonitor:
    """Track threshold crossings and avoid duplicate alerts per stop visit.

    Initial data is treated as a baseline. That prevents a Home Assistant
    restart from generating notifications for already delayed/cancelled buses.
    Subsequent newly observed trips are eligible for alerts.
    """

    def __init__(
        self,
        kind: str,
        *,
        line: str = "",
        destination: str = "",
        threshold: int = 10,
    ) -> None:
        if kind not in (DEPARTURE_SOON, DELAY_REACHED, TRIP_CANCELLED):
            raise ValueError("Invalid rule kind")
        if not 1 <= threshold <= 120:
            raise ValueError("Threshold must be between 1 and 120")
        self.kind = kind
        self.line = line.strip()
        self.destination = destination.strip()
        self.threshold = threshold
        self._initialized = False
        self._previous: dict[tuple[str, str, str, str], tuple[int | None, bool]] = {}
        self._fired: dict[tuple[str, str, str, str], datetime] = {}

    def evaluate(
        self,
        rows: list[dict[str, Any]],
        *,
        now: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Return the departure payloads whose trigger should fire now."""
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            raise ValueError("now must be timezone-aware")
        now = now.astimezone(timezone.utc)
        active: dict[tuple[str, str, str, str], tuple[int | None, bool]] = {}
        matching: list[tuple[tuple[str, str, str, str], datetime, dict[str, Any]]] = []

        for row in rows:
            if not isinstance(row, dict) or not _matches(row, self.line, self.destination):
                continue
            departure = parse_time(row.get("abfahrt") or row.get("plan_abfahrt"))
            if departure is None or departure < now:
                continue
            key = _trip_key(row)
            if not key[1]:
                continue
            active[key] = (_delay(row), bool(row.get("ausfall")))
            matching.append((key, departure, row))

        # A startup or automation edit should not replay an already active alert.
        if not self._initialized:
            self._previous = active
            if self.kind == DEPARTURE_SOON:
                for key, departure, row in matching:
                    remaining = (departure - now).total_seconds()
                    if not row.get("ausfall") and 0 <= remaining <= self.threshold * 60:
                        self._fired[key] = departure
            self._initialized = True
            return []

        result: list[dict[str, Any]] = []
        for key, departure, row in matching:
            if key in self._fired:
                continue
            delay, cancelled = active[key]
            prev = self._previous.get(key)
            remaining = (departure - now).total_seconds()
            if self.kind == DEPARTURE_SOON:
                matched = not cancelled and 0 <= remaining <= self.threshold * 60
            elif self.kind == DELAY_REACHED:
                matched = (
                    not cancelled
                    and delay is not None
                    and delay >= self.threshold
                    and (prev is None or prev[0] is None or prev[0] < self.threshold)
                )
            else:
                matched = cancelled and (prev is None or not prev[1])

            if not matched:
                continue
            self._fired[key] = departure
            result.append({
                "trip_id": str(row.get("fahrt_id") or ""),
                "line": str(row.get("linie") or ""),
                "destination": str(row.get("ziel") or ""),
                "departure": row.get("abfahrt"),
                "scheduled_departure": row.get("plan_abfahrt") or row.get("abfahrt"),
                "minutes_until_departure": max(0, round(remaining / 60)),
                "delay_minutes": delay,
                "cancelled": cancelled,
            })

        self._previous = active
        # Keep deduplication through short loss/reappearance of API data, but
        # discard long-gone journeys so a running automation doesn't leak RAM.
        self._fired = {
            key: departure for key, departure in self._fired.items()
            if departure >= now - timedelta(hours=24)
        }
        return result

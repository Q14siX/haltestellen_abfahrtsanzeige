"""Transitous/MOTIS client for town-wide stop selection and bus journeys."""

from __future__ import annotations

import asyncio
import logging
import math
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from collections.abc import Mapping
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout

from .const import API_BASE, API_TIMEOUT, CITY_SEARCH_RADIUS_KM, VERSION

_LOGGER = logging.getLogger(__name__)


class TransitousError(Exception):
    """Raised when the public Transitous service cannot provide data."""

    def __init__(self, message: str, *, status_code: int | None = None,
                 error_category: str = "api", retry_after_seconds: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_category = error_category
        self.retry_after_seconds = retry_after_seconds


def _retry_after_seconds(value: str | None) -> int | None:
    """Accept RFC Retry-After seconds or HTTP date, capped to one day."""
    if not value:
        return None
    value = value.strip()
    if value.isascii() and value.isdecimal():
        return min(86400, int(value[:12]))
    try:
        date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        return min(86400, max(0, int((date - datetime.now(timezone.utc)).total_seconds())))
    except (TypeError, ValueError, OverflowError):
        return None


class TransitousClient:
    """Resolve town names and enumerate real stop IDs from the geographic map."""

    def __init__(self, session: ClientSession, language: str = "en") -> None:
        self._session = session
        language_code = str(language).replace("_", "-").split("-")[0].lower()
        self._language = language_code if re.fullmatch(r"[a-z]{2,3}", language_code) else "en"

    def _message(self, key: str, **details: Any) -> str:
        """Localized diagnostics for the selected Home Assistant language."""
        messages = {
            "de": {
                "http_error": "HTTP {status} bei {path}: {details}",
                "network_error": "Netzwerk- oder Antwortfehler bei {path}: {details}",
                "api_error": "API-Fehler bei {path}: {details}",
                "unexpected_city": "Unerwartete Antwort bei der Ortssuche",
                "unexpected_stop": "Unerwartete Antwort bei der Haltestellensuche",
                "unexpected_map": "Unerwartete Antwort der Haltestellenkarte",
                "unexpected_legacy": "Ungültige Antwort der Haltestellensuche",
                "stop_not_found": "Haltestelle '{name}' ({stop_id}) nicht zuordenbar. Bitte erneut einrichten.",
                "unexpected_departures": "Ungültige Antwort der Haltestellen-Abfahrtsabfrage",
            },
            "en": {
                "http_error": "HTTP {status} at {path}: {details}",
                "network_error": "Network or response error at {path}: {details}",
                "api_error": "API error at {path}: {details}",
                "unexpected_city": "Unexpected response from town search",
                "unexpected_stop": "Unexpected response from stop search",
                "unexpected_map": "Unexpected response from the stop map",
                "unexpected_legacy": "Invalid response from stop lookup",
                "stop_not_found": "Unable to resolve stop '{name}' ({stop_id}). Please configure it again.",
                "unexpected_departures": "Invalid response from stop departure query",
            },
        }
        language = "de" if self._language == "de" else "en"
        return messages[language][key].format(**details)

    async def _get(self, path: str, params: dict[str, Any]) -> Any:
        """Raise actionable errors rather than calling every HTTP failure an outage."""
        try:
            async with self._session.get(
                f"{API_BASE}{path}",
                params=params,
                timeout=ClientTimeout(total=API_TIMEOUT),
                headers={
                    "Accept": "application/json",
                    "User-Agent": f"StopDepartureDisplay/{VERSION} (+https://github.com/Q14siX)",
                },
            ) as response:
                if response.status >= 400:
                    details = (await response.text())[:350].replace("\n", " ")
                    raise TransitousError(
                        self._message("http_error", status=response.status, path=path, details=details or response.reason),
                        status_code=response.status, error_category="http",
                        retry_after_seconds=_retry_after_seconds(response.headers.get("Retry-After")),
                    )
                result = await response.json(content_type=None)
        except TransitousError:
            raise
        except (ClientError, asyncio.TimeoutError, ValueError) as exc:
            raise TransitousError(self._message("network_error", path=path, details=exc), error_category="network") from exc
        if isinstance(result, dict) and result.get("error"):
            raise TransitousError(self._message("api_error", path=path, details=str(result["error"])[:350]))
        return result

    @staticmethod
    def _coordinates(item: Any) -> tuple[float, float] | None:
        if not isinstance(item, Mapping):
            return None
        try:
            lat, lon = float(item["lat"]), float(item["lon"])
        except (TypeError, ValueError, KeyError):
            return None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None
        return lat, lon

    @staticmethod
    def _is_city_match(item: dict[str, Any], city: str) -> bool:
        """Accept place names and administrative areas, not unrelated fuzzy matches."""
        target = city.strip().casefold()
        name = item.get("name")
        if isinstance(name, str) and name.strip().casefold() == target:
            return True
        return any(
            isinstance(area, dict)
            and isinstance(area.get("name"), str)
            and area["name"].strip().casefold() == target
            for area in (item.get("areas") or [])
        )

    async def _town_center(self, town: str) -> tuple[float, float] | None:
        """Resolve a place, or a representative stop if no explicit place exists."""
        # A location lookup only selects the geographic center; it does NOT
        # determine the selectable stops. Those all come from /map/stops.
        places = await self._get(
            "/api/v1/geocode",
            {"text": town, "type": "PLACE", "language": self._language},
        )
        if not isinstance(places, list):
            raise TransitousError(self._message("unexpected_city"))
        for candidate in places:
            if (
                isinstance(candidate, dict)
                and self._is_city_match(candidate, town)
                and (point := self._coordinates(candidate)) is not None
            ):
                return point

        # Some small towns are indexed only as the administrative area of stops.
        stops = await self._get(
            "/api/v1/geocode",
            {"text": town, "type": "STOP", "language": self._language},
        )
        if not isinstance(stops, list):
            raise TransitousError(self._message("unexpected_stop"))
        points = [
            point
            for item in stops
            if isinstance(item, dict)
            and self._is_city_match(item, town)
            and (point := self._coordinates(item)) is not None
        ]
        if not points:
            return None
        # The median is resistant to individual stations far from the town center.
        latitudes = sorted(lat for lat, _ in points)
        longitudes = sorted(lon for _, lon in points)
        return latitudes[len(points) // 2], longitudes[len(points) // 2]

    async def list_city_stops(self, town: str) -> list[dict[str, str]]:
        """Fetch ALL stops returned for a town area, rather than geocode suggestions.

        The town is used to resolve a point, and the real stop inventory is
        returned by the MOTIS map/stops geographic endpoint. Coverage is a
        geographic search radius; it is not an administrative polygon filter.
        """
        town = town.strip()
        if len(town) < 2:
            return []
        center = await self._town_center(town)
        if center is None:
            return []
        lat, lon = center
        latitude_offset = CITY_SEARCH_RADIUS_KM / 111.1
        longitude_offset = CITY_SEARCH_RADIUS_KM / (111.1 * max(0.1, math.cos(math.radians(lat))))
        south = max(-90.0, lat - latitude_offset)
        north = min(90.0, lat + latitude_offset)
        west = max(-180.0, lon - longitude_offset)
        east = min(180.0, lon + longitude_offset)
        data = await self._get(
            "/api/v6/map/stops",
            {
                "min": f"{south:.6f},{west:.6f}",
                "max": f"{north:.6f},{east:.6f}",
                # The map API can return parent stations instead of a separate
                # entry for every platform or bus stop pole.
                "grouped": "true",
                "language": self._language,
            },
        )
        if not isinstance(data, list):
            raise TransitousError(self._message("unexpected_map"))
        return self._group_stop_places(data, language=self._language)

    @staticmethod
    def _parent_stop_id(place: dict[str, Any]) -> str:
        """Prefer the API parent ID, then the DELFI bus-platform hierarchy.

        DELFI stop positions such as de-DELFI_de:09762:901:0:1 and
        de-DELFI_de:09762:901:0:2 belong to the same parent stop
        de-DELFI_de:09762:901. Do not infer a travel direction from the ID.
        """
        stop_id = place["stopId"].strip()
        parent_id = place.get("parentId")
        if isinstance(parent_id, str) and parent_id.strip():
            return parent_id.strip()
        # This is specifically the DELFI platform hierarchy, not a generic
        # truncation of potentially unrelated IDs in other data feeds.
        match = re.fullmatch(r"(de-DELFI_de:\d+:\d+):0:\d+", stop_id)
        return match.group(1) if match else stop_id

    @classmethod
    def _group_stop_places(cls, places: list[Any], language: str = "de") -> list[dict[str, Any]]:
        """Combine stop poles for display, retaining real position for routing.

        Do not pass manually shortened DELFI IDs to /plan: they may not
        exist as routable objects. Coordinates + a small radius cover both
        sides of the road and are explicitly supported by the MOTIS planner.
        """
        grouped: dict[str, dict[str, Any]] = {}
        for place in places:
            if not isinstance(place, dict):
                continue
            stop_id, name = place.get("stopId"), place.get("name")
            position = cls._coordinates(place)
            if not isinstance(stop_id, str) or not stop_id.strip():
                continue
            if not isinstance(name, str) or not name.strip() or position is None:
                continue
            name = name.strip()
            canonical_id = cls._parent_stop_id(place)
            existing = grouped.get(canonical_id)
            if existing is None:
                grouped[canonical_id] = {
                    "id": stop_id.strip(), "name": name, "label": name,
                    "lat": position[0], "lon": position[1], "_count": 1, "group_id": canonical_id,
                }
            else:
                count = existing["_count"]
                existing["lat"] = (existing["lat"] * count + position[0]) / (count + 1)
                existing["lon"] = (existing["lon"] * count + position[1]) / (count + 1)
                existing["_count"] = count + 1
                if len(name) < len(existing["name"]):
                    existing["name"] = name
                    existing["label"] = name
        by_name: dict[str, list[dict[str, Any]]] = {}
        for stop in grouped.values():
            stop.pop("_count", None)
            by_name.setdefault(stop["name"].casefold(), []).append(stop)
        for same_name in by_name.values():
            if len(same_name) > 1:
                for idx, stop in enumerate(sorted(same_name, key=lambda s: s["id"]), start=1):
                    label = "Standort" if language == "de" else "Location"
                    stop["label"] = f"{stop['name']} · {label} {idx}"
        return sorted(grouped.values(), key=lambda s: (s["name"].casefold(), s["label"].casefold()))

    async def resolve_legacy_stop(self, name: str, old_id: str) -> tuple[float, float]:
        """Resolve coordinates for entries created before positions were saved.

        Only accept matching IDs or labels; never silently map a route to
        an unrelated nearby stop. A distinct stop name alone is not enough
        when multiple platforms with identical labels exist.
        """
        data = await self._get(
            "/api/v1/geocode",
            {"text": name, "type": "STOP", "language": self._language},
        )
        if not isinstance(data, list):
            raise TransitousError(self._message("unexpected_legacy"))
        candidates = []
        for stop in data:
            if not isinstance(stop, dict):
                continue
            position = self._coordinates(stop)
            raw_id = stop.get("stopId")
            if position is None or not isinstance(raw_id, str):
                continue
            canonical_id = self._parent_stop_id(stop)
            if raw_id == old_id or canonical_id == old_id:
                candidates.append(position)
        if not candidates:
            # Geocode may only return a few of the many bus stops named after
            # a town. The full area inventory is more reliable for migration.
            town = name.split(",", 1)[0].strip()
            for stop in await self.list_city_stops(town):
                if stop["id"] == old_id:
                    return stop["lat"], stop["lon"]
            # No guessed relocation if an existing stored stop is not present.
            raise TransitousError(self._message("stop_not_found", name=name, stop_id=old_id))
        return (
            sum(point[0] for point in candidates) / len(candidates),
            sum(point[1] for point in candidates) / len(candidates),
        )

    async def get_departures(
        self, stop_id: str, position: tuple[float, float] | None = None,
        count: int = 40,
    ) -> dict[str, Any]:
        """Get all forthcoming BUS/COACH departures, not route itineraries.

        StopTimes collects the station and its child platforms. A small optional
        radius covers the opposite roadside pole. arriveBy=false requests departures.
        """
        params: dict[str, Any] = {
            "stopId": stop_id,
            "arriveBy": "false",
            "mode": "BUS,COACH",
            "n": max(20, min(int(count), 80)),
            "language": self._language,
            # MOTIS provides following stops in each departure event; no per-trip calls.
            "fetchStops": "true",
        }
        # The stop-times endpoint automatically includes matching platforms.
        # A radius includes nearby poles, but can also include adjacent stations;
        # keep this small so that the selected physical stop remains meaningful.
        if position is not None:
            params.update({"radius": 90, "exactRadius": "false"})
        result = await self._get("/api/v6/stoptimes", params)
        if not isinstance(result, dict) or not isinstance(result.get("stopTimes"), list):
            raise TransitousError(self._message("unexpected_departures"))
        return result

"""Authenticated, on-demand transit route shapes for the departure board.

Trip geometry is supplied by MOTIS, not inferred from straight-line stop pairs.
Requests are restricted to trips visible in the currently configured stop entries.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
import logging
import math
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import TransitousClient, TransitousError
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)
_CACHE_TTL = timedelta(minutes=20)
_MISSING_TTL = timedelta(minutes=2)
_MAX_CACHE = 64
_MAX_POLYLINE_LENGTH = 60000
_MAX_DECODED_POINTS = 12000
_MAX_OUTPUT_POINTS = 800
_MAX_STOP_DISTANCE_M = 650


def decode_polyline(encoded: str, precision: int) -> list[tuple[float, float]]:
    """Decode Google encoded polyline, honoring its declared precision.

    The geometry API may return precision 5 or 6 (older versions used 7).
    Reject corrupt, oversize or implausible payloads instead of drawing them.
    """
    if not isinstance(encoded, str) or not encoded or len(encoded) > _MAX_POLYLINE_LENGTH:
        return []
    if not isinstance(precision, int) or isinstance(precision, bool) or not 1 <= precision <= 7:
        return []
    lat = lon = 0
    offset = 0
    result: list[tuple[float, float]] = []
    scale = 10 ** precision

    def read_value() -> int:
        nonlocal offset
        value = shift = 0
        while offset < len(encoded):
            digit = ord(encoded[offset]) - 63
            offset += 1
            if not 0 <= digit <= 63 or shift > 35:
                raise ValueError("invalid encoded polyline")
            value |= (digit & 31) << shift
            if digit < 32:
                return ~(value >> 1) if value & 1 else value >> 1
            shift += 5
        raise ValueError("truncated encoded polyline")

    try:
        while offset < len(encoded):
            lat += read_value()
            lon += read_value()
            point = (lat / scale, lon / scale)
            if not (-85.0511 <= point[0] <= 85.0511 and -180 <= point[1] <= 180):
                return []
            result.append(point)
            if len(result) > _MAX_DECODED_POINTS:
                return []
    except ValueError:
        return []
    return result if len(result) >= 2 else []


def _distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Local equirectangular distance for matching route coordinates to stops."""
    lat = math.radians((a[0] + b[0]) / 2)
    north = (a[0] - b[0]) * 111195
    east = (a[1] - b[1]) * 111195 * math.cos(lat)
    return math.hypot(north, east)


def _stop_position(raw: Any) -> tuple[float, float] | None:
    if not isinstance(raw, Mapping):
        return None
    try:
        latitude, longitude = float(raw["lat"]), float(raw["lon"])
    except (TypeError, ValueError, KeyError):
        return None
    if not (math.isfinite(latitude) and math.isfinite(longitude)):
        return None
    if not (-85 <= latitude <= 85 and -180 <= longitude <= 180):
        return None
    return latitude, longitude


def _target_stops(row: Mapping[str, Any]) -> list[tuple[float, float]]:
    try:
        first = {"lat": row["start_lat"], "lon": row["start_lon"]}
    except KeyError:
        return []
    start = _stop_position(first)
    if start is None:
        return []
    following = row.get("folgende_haltestellen")
    targets = [start]
    if isinstance(following, list):
        for stop in following[:30]:
            if (point := _stop_position(stop)) is not None:
                targets.append(point)
    return targets


def _slice_from_departure(
    shape: list[tuple[float, float]], stops: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Cut the supplied trip shape at the selected stop and the last known stop.

    Stop order is followed so circular lines do not accidentally reverse the
    polyline or jump to earlier portions of a route.
    """
    if len(shape) < 2 or len(stops) < 2:
        return []
    start = min(range(len(shape)), key=lambda i: _distance_m(shape[i], stops[0]))
    if _distance_m(shape[start], stops[0]) > _MAX_STOP_DISTANCE_M:
        return []
    cursor = start
    matched = 0
    for target in stops[1:]:
        if cursor >= len(shape) - 1:
            break
        nearest = min(range(cursor + 1, len(shape)), key=lambda i: _distance_m(shape[i], target))
        if _distance_m(shape[nearest], target) <= _MAX_STOP_DISTANCE_M:
            cursor = nearest
            matched += 1
    if matched == 0 or cursor <= start:
        return []
    return shape[start:cursor + 1]


def _point_segment_distance(point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Point-to-segment distance, in approximately metric projected coordinates."""
    lat_rad = math.radians((point[0] + a[0] + b[0]) / 3)
    scale_x = 111195 * math.cos(lat_rad)
    scale_y = 111195
    px, py = point[1] * scale_x, point[0] * scale_y
    ax, ay = a[1] * scale_x, a[0] * scale_y
    bx, by = b[1] * scale_x, b[0] * scale_y
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy))) if dx*dx + dy*dy else 0
    return math.hypot(px - (ax + t*dx), py - (ay + t*dy))


def _simplify(points: list[tuple[float, float]]) -> list[list[float]]:
    """Retain turns while bounding the number of points sent to the browser."""
    if len(points) <= 2:
        return [[round(a, 6), round(b, 6)] for a, b in points]
    keep = {0, len(points)-1}
    stack = [(0, len(points)-1)]
    while stack:
        start, end = stack.pop()
        farthest, candidate = 7.0, None
        for i in range(start+1, end):
            delta = _point_segment_distance(points[i], points[start], points[end])
            if delta > farthest:
                farthest, candidate = delta, i
        if candidate is not None:
            keep.add(candidate)
            stack.append((start, candidate))
            stack.append((candidate, end))
    ordered = sorted(keep)
    if len(ordered) > _MAX_OUTPUT_POINTS:
        indices = [round(i * (len(ordered)-1)/(_MAX_OUTPUT_POINTS-1)) for i in range(_MAX_OUTPUT_POINTS)]
        ordered = [ordered[i] for i in indices]
    return [[round(points[i][0], 6), round(points[i][1], 6)] for i in ordered]


def geometry_from_itinerary(payload: Any, row: Mapping[str, Any]) -> list[list[float]]:
    """Accept only MOTIS bus/coach leg shapes for the requested trip."""
    if not isinstance(payload, Mapping) or not isinstance(payload.get("legs"), list):
        return []
    trip_id = row.get("fahrt_id")
    candidates = [leg for leg in payload["legs"] if isinstance(leg, Mapping)
                  and leg.get("mode") in ("BUS", "COACH")]
    matches = [leg for leg in candidates if leg.get("tripId") == trip_id]
    # Some MOTIS versions do not repeat the opaque trip ID within a /trip leg.
    if not matches and len(candidates) == 1 and not candidates[0].get("tripId"):
        matches = candidates
    if not matches:
        return []
    shape: list[tuple[float, float]] = []
    for leg in matches:
        geometry = leg.get("legGeometry")
        if not isinstance(geometry, Mapping):
            continue
        decoded = decode_polyline(geometry.get("points"), geometry.get("precision"))
        if not decoded:
            continue
        if shape and _distance_m(shape[-1], decoded[0]) < 150:
            shape.extend(decoded[1:])
        elif not shape:
            shape.extend(decoded)
        else:
            return []
    cropped = _slice_from_departure(shape, _target_stops(row))
    return _simplify(cropped) if len(cropped) >= 2 else []


class TripGeometryService:
    """Bounded cache and request coalescing for opt-in expanded trip shapes."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.client = TransitousClient(async_get_clientsession(hass), hass.config.language)
        self.cache: OrderedDict[str, tuple[datetime, list[list[float]]]] = OrderedDict()
        self.pending: dict[str, asyncio.Task[list[list[float]]]] = {}
        self.semaphore = asyncio.Semaphore(3)

    def _active_row(self, trip_id: str) -> Mapping[str, Any] | None:
        for coordinator in self.hass.data.get(DOMAIN, {}).values():
            data = getattr(coordinator, "data", None)
            if not isinstance(data, Mapping):
                continue
            for row in data.get("abfahrten", []):
                if isinstance(row, Mapping) and row.get("fahrt_id") == trip_id:
                    return row
        return None

    async def get(self, trip_id: str) -> tuple[bool, list[list[float]]]:
        """Only allow departures currently belonging to the user's stops."""
        row = self._active_row(trip_id)
        if row is None:
            return False, []
        now = datetime.now(timezone.utc)
        cached = self.cache.get(trip_id)
        if cached and cached[0] > now:
            self.cache.move_to_end(trip_id)
            return True, cached[1]
        pending = self.pending.get(trip_id)
        if pending is None:
            pending = self.hass.async_create_task(self._load(trip_id, row))
            self.pending[trip_id] = pending
            pending.add_done_callback(lambda _task: self.pending.pop(trip_id, None))
        try:
            geometry = await asyncio.shield(pending)
        except (TransitousError, ValueError, TypeError, asyncio.TimeoutError):
            _LOGGER.debug("No MOTIS shape available for trip %s", trip_id)
            geometry = []
        self.cache[trip_id] = (now + (_CACHE_TTL if geometry else _MISSING_TTL), geometry)
        self.cache.move_to_end(trip_id)
        while len(self.cache) > _MAX_CACHE:
            self.cache.popitem(last=False)
        return True, geometry

    async def _load(self, trip_id: str, row: Mapping[str, Any]) -> list[list[float]]:
        async with self.semaphore:
            payload = await self.client._get(
                "/api/v6/trip",
                {"tripId": trip_id, "detailedLegs": "true", "language": self.client._language},
            )
        return geometry_from_itinerary(payload, row)


class TripGeometryView(HomeAssistantView):
    """JSON endpoint queried by the installed Lovelace card only on expansion."""

    url = "/api/haltestellen_abfahrtsanzeige/route"
    name = "api:haltestellen_abfahrtsanzeige:route"
    requires_auth = True

    def __init__(self, service: TripGeometryService) -> None:
        self.service = service

    async def get(self, request: web.Request) -> web.Response:
        trip_id = request.query.get("trip_id", "")
        if not 1 <= len(trip_id) <= 1024 or any(ord(char) < 32 for char in trip_id):
            return self.json({"error": "Invalid trip ID"}, status_code=400)
        accepted, points = await self.service.get(trip_id)
        if not accepted:
            return self.json({"error": "Trip is not part of a configured stop"}, status_code=404)
        return self.json({"geometry": points, "source": "motis" if points else "unavailable"})
